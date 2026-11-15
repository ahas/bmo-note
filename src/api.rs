//! The routes (`docs/api.md`): who calls (the service token or the console's credential with the reader's
//! key and role) and what they reach of a note, the notes, the event stream and the health, beside the
//! sharing routes (`crate::share`) and the console face (`docs/api.md`, 「Console」).

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration as StdDuration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::sse::{Event as Sent, KeepAlive, Sse};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post, put};
use bmo_console_face::{ConsoleFace, OWNER_KEY_HEADER};
use futures_util::{StreamExt, stream};
use serde::de::DeserializeOwned;

use crate::app::App;
use crate::error::ApiError;
use crate::events::Record;
use crate::model::{
  KEY_MAX, clean_icon, clean_text, clean_title, decode_doc, encode_doc, fresh_id, makeable_id, now_ms,
  parse_list_cursor, valid_blob_id,
};
use crate::own;
use crate::share;
use crate::store::{Copied, Saved, Written};
use crate::wire::{
  Access, DeleteQuery, EventsQuery, Health, NewCopy, NewNote, Note, NoteEvent, NoteIcon, NoteMeta,
  NoteQuery, NoteSave, NoteText, NotesQuery, Page, ReadQuery, StreamEvent,
};

/// The most rows and events one page holds.
pub const PAGE_MAX: i64 = 200;

/// The cache line of a stored image, whose key never names other bytes.
const KEPT_FOR_GOOD: &str = "private, max-age=31536000, immutable";

/// How often a comment line keeps a stream open.
const KEEP_OPEN: StdDuration = StdDuration::from_secs(15);

pub(crate) type Answer<T> = Result<T, ApiError>;

/// Every route, the unknown ones answered `no-route`: the health, the routes the screens call under the
/// console face's guard, and the face's own routes, where a face stands (`docs/api.md`, 「Console」).
pub fn router(app: Arc<App>, face: Option<ConsoleFace>) -> Router {
  let screens = screens();
  let screens = match &face {
    Some(face) => face.guard_screens(screens),
    None => screens,
  };
  let mut routes = Router::new().route("/health", get(health)).merge(screens);
  if let Some(face) = &face {
    routes = routes.merge(face.router());
  }
  routes
    .fallback(|| async { ApiError::no_route() })
    .method_not_allowed_fallback(|| async { ApiError::no_route() })
    .with_state(app)
}

/// The routes that act for a reader, which the screens call.
fn screens() -> Router<Arc<App>> {
  Router::new()
    .route("/events", get(events))
    .route("/notes", get(list_notes).post(create_note))
    .route("/notes/{noteId}", get(read_note).patch(save_note).delete(delete_note))
    .route("/notes/{noteId}/blobs/{blobId}", get(read_blob).put(put_blob))
    .route("/notes/{noteId}/text", put(write_text))
    .route("/notes/{noteId}/icon", put(write_icon))
    .route("/notes/{noteId}/duplicate", post(duplicate_note))
    .merge(own::routes())
    .merge(share::routes())
}

/// Who calls.
#[derive(Clone, Debug)]
pub(crate) struct Caller {
  /// The service token's caller, rather than the console's.
  pub service: bool,
  /// The account the call answers for: the reader's key, or the service token's `owner`.
  pub owner: String,
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
  headers
    .get(header::AUTHORIZATION)?
    .to_str()
    .ok()?
    .strip_prefix("Bearer ")
    .map(str::trim)
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
  headers.get(name)?.to_str().ok().map(str::trim).filter(|value| !value.is_empty())
}

/// Whether the credential is the service's (true), the console's (false), or neither (401).
pub(crate) fn credential(app: &App, headers: &HeaderMap) -> Answer<bool> {
  let given = bearer(headers).ok_or_else(ApiError::unauthorized)?;
  let server = &app.settings.server.token;
  let console = &app.settings.console.token;
  if !server.is_empty() && given == server {
    Ok(true)
  } else if !console.is_empty() && given == console {
    Ok(false)
  } else {
    Err(ApiError::unauthorized())
  }
}

/// The account a route of the screens answers for: the reader's key on a console call, the named
/// `owner` on a service-token call.
pub(crate) fn caller(app: &App, headers: &HeaderMap, owner: Option<String>) -> Answer<Caller> {
  if credential(app, headers)? {
    let owner = owner.map(|owner| owner.trim().to_owned()).filter(|owner| !owner.is_empty());
    let owner = owner.ok_or_else(ApiError::no_owner)?;
    if owner.chars().count() > KEY_MAX {
      return Err(ApiError::no_owner());
    }
    return Ok(Caller {
      service: true,
      owner,
    });
  }
  // The console face's guard has held the call to the manifest's role and owner key; the key names the account.
  let key = header_text(headers, OWNER_KEY_HEADER)
    .ok_or_else(|| ApiError::forbidden("The call carries no Owner-Key."))?;
  if key.chars().count() > KEY_MAX {
    return Err(ApiError::forbidden("The Owner-Key is longer than 200 characters."));
  }
  Ok(Caller {
    service: false,
    owner: key.to_owned(),
  })
}

/// The note a route of one note reaches: the account it belongs to, and what the caller holds of it.
#[derive(Clone, Debug)]
pub(crate) struct Reach {
  /// The account the note belongs to.
  pub owner: String,
  /// The account the call answers for: the reader, or the service token's `owner`.
  pub account: String,
  pub access: Access,
}

impl Reach {
  /// Refuses a caller whose share does not open the note's writes.
  pub fn writes(&self) -> Answer<()> {
    if self.access.writes() {
      Ok(())
    } else {
      Err(ApiError::forbidden("The note is shared with the caller to read only."))
    }
  }

  /// Refuses a member: what follows is the owner's alone.
  pub fn owns(&self) -> Answer<()> {
    if self.access == Access::Owner {
      Ok(())
    } else {
      Err(ApiError::forbidden("Only the note's owner does this."))
    }
  }

  /// The note's metadata as the caller holds it.
  pub fn held(&self, meta: NoteMeta) -> NoteMeta {
    NoteMeta {
      access: self.access,
      ..meta
    }
  }
}

/// What a call reaches of note `note`. A service-token call acts for the `owner` it names. A console call
/// reaches the reader's own note, or, naming another account with `owner`, that account's note where it
/// lives and is shared with the reader; anything else of another's stands as no note at all (`docs/api.md`,
/// 「Sharing」).
pub(crate) fn reach(app: &App, headers: &HeaderMap, owner: Option<String>, note: &str) -> Answer<Reach> {
  let named = owner.as_deref().map(str::trim).filter(|named| !named.is_empty()).map(str::to_owned);
  let caller = caller(app, headers, owner)?;
  let own = Reach {
    owner: caller.owner.clone(),
    account: caller.owner.clone(),
    access: Access::Owner,
  };
  let Some(named) = named.filter(|named| !caller.service && *named != caller.owner) else {
    return Ok(own);
  };
  match app.store.permission(&named, note, &caller.owner).map_err(ApiError::failed)? {
    Some(permission) => Ok(Reach {
      owner: named,
      account: caller.owner,
      access: permission.access(),
    }),
    None => Err(ApiError::not_found(format!("No note {note} stands."))),
  }
}

/// The accounts an event of `owner`'s note `note` reaches: the owner and whoever it is shared with.
fn audience(app: &App, owner: &str, note: &str) -> Vec<String> {
  let members = app.store.members(owner, note).unwrap_or_default();
  std::iter::once(owner.to_owned())
    .chain(members.into_iter().map(|member| member.user))
    .collect()
}

/// A note's event published to `audience`.
fn publish_note(app: &App, kind: &str, owner: &str, note: &str, audience: Vec<String>) {
  let data = NoteEvent {
    note_id: note.to_owned(),
    owner: owner.to_owned(),
  };
  app.events.publish(kind, data, audience);
}

/// The caller of the event stream: the service token reads every one, the console reader its own.
fn stream_caller(app: &App, headers: &HeaderMap) -> Answer<Caller> {
  if credential(app, headers)? {
    return Ok(Caller {
      service: true,
      owner: String::new(),
    });
  }
  caller(app, headers, None)
}

pub(crate) fn query<T: DeserializeOwned>(given: Result<Query<T>, QueryRejection>) -> Answer<T> {
  given.map(|Query(query)| query).map_err(|why| ApiError::bad_request(why.body_text()))
}

pub(crate) fn body<T: DeserializeOwned>(bytes: &Bytes) -> Answer<T> {
  serde_json::from_slice(bytes)
    .map_err(|why| ApiError::bad_request(format!("The body does not read: {why}")))
}

// ---------------------------------------------------------------------------------------------------------
// Health

async fn health(State(app): State<Arc<App>>, headers: HeaderMap) -> Answer<Json<Health>> {
  credential(&app, &headers)?;
  Ok(Json(Health {
    ready: true,
    reason: None,
    version: env!("CARGO_PKG_VERSION").to_owned(),
  }))
}

// ---------------------------------------------------------------------------------------------------------
// The notes

pub(crate) fn limit_of(given: Option<i64>) -> Answer<i64> {
  let limit = given.unwrap_or(50);
  if !(1..=PAGE_MAX).contains(&limit) {
    return Err(ApiError::bad_request(format!("limit is 1 to {PAGE_MAX}")));
  }
  Ok(limit)
}

async fn list_notes(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given: Result<Query<NotesQuery>, QueryRejection>,
) -> Answer<Json<Page<NoteMeta>>> {
  let given = query(given)?;
  let caller = caller(&app, &headers, given.owner)?;
  let limit = limit_of(given.limit)?;
  let deleted = given.deleted.unwrap_or(false);
  let shared = given.shared.unwrap_or(false);
  if shared && deleted {
    return Err(ApiError::bad_request(
      "The shared view holds no trash: name deleted or shared, not both.",
    ));
  }
  let order = given.sort.unwrap_or_default();
  let after = match given.after.as_deref() {
    None => None,
    Some(after) => Some(parse_list_cursor(order, after, shared).ok_or_else(|| {
      ApiError::bad_request("after is the last row's key in the order named and its id, joined by colons.")
    })?),
  };
  let (items, more) = if shared {
    app.store.list_shared(&caller.owner, order, after.as_ref(), limit)
  } else {
    app.store.list(&caller.owner, deleted, order, after.as_ref(), limit)
  }
  .map_err(ApiError::failed)?;
  Ok(Json(Page { items, more }))
}

async fn create_note(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let caller = caller(&app, &headers, query(given_query)?.owner)?;
  let given: NewNote = body(&bytes)?;
  let id = match given.id.as_deref() {
    Some(id) if makeable_id(id) => id.to_owned(),
    Some(_) => {
      return Err(ApiError::bad_request(
        "The id is not 1 to 64 letters, digits, - and _, or names a route.",
      ));
    }
    None => fresh_id(),
  };
  let title = clean_title(&given.title)?;
  let doc = decode_doc(&given.doc, app.settings.notes.max_doc_bytes)?;
  let at = now_ms();
  let (meta, made) = app.store.create(&caller.owner, &id, &title, &doc, at).map_err(ApiError::failed)?;
  if made {
    publish_note(&app, "note.saved", &caller.owner, &id, vec![caller.owner.clone()]);
  }
  let status = if made { StatusCode::CREATED } else { StatusCode::OK };
  Ok(json_answer(status, meta))
}

async fn read_note(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<ReadQuery>, QueryRejection>,
) -> Answer<Json<Note>> {
  let given = query(given)?;
  let reach = reach(&app, &headers, given.owner, &id)?;
  let deleted = given.deleted.unwrap_or(false);
  if deleted && reach.access != Access::Owner {
    return Err(ApiError::not_found(format!("No note {id} stands in the trash.")));
  }
  let row = app
    .store
    .note(&reach.owner, &id, Some(deleted))
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found(format!("No note {id} stands where it was asked for.")))?;
  if given.opened.unwrap_or(false) && !deleted {
    app
      .store
      .record_opened(&reach.account, &reach.owner, &id, now_ms())
      .map_err(ApiError::failed)?;
  }
  Ok(Json(Note {
    doc: encode_doc(&row.doc),
    meta: reach.held(row.meta),
  }))
}

async fn save_note(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let reach = reach(&app, &headers, query(given_query)?.owner, &id)?;
  reach.writes()?;
  let given: NoteSave = body(&bytes)?;
  if given.version < 1 {
    return Err(ApiError::bad_request("version is a whole number from 1."));
  }
  let restore = given.restore.unwrap_or(false);
  if restore {
    reach.owns()?;
  }
  let title = given.title.as_deref().map(clean_title).transpose()?;
  let max = app.settings.notes.max_doc_bytes;
  let doc = given.doc.as_deref().map(|doc| decode_doc(doc, max)).transpose()?;
  if given.text.is_some() && doc.is_none() {
    return Err(ApiError::bad_request("A text stands only with the doc it was read from."));
  }
  let text = given.text.as_deref().map(|text| clean_text(text, max)).transpose()?;
  let at = now_ms();
  let saved = app
    .store
    .save(
      &reach.owner,
      &id,
      title.as_deref(),
      doc.as_deref(),
      text.as_deref(),
      given.version,
      restore,
      at,
    )
    .map_err(ApiError::failed)?;
  let published =
    |kind: &str| publish_note(&app, kind, &reach.owner, &id, audience(&app, &reach.owner, &id));
  match saved {
    Saved::Unchanged(meta) => Ok(json_answer(StatusCode::OK, reach.held(meta))),
    Saved::Saved(meta) => {
      published("note.saved");
      Ok(json_answer(StatusCode::OK, reach.held(meta)))
    }
    Saved::Restored(meta) => {
      published("note.restored");
      Ok(json_answer(StatusCode::OK, reach.held(meta)))
    }
    Saved::Conflict(meta) => Ok(conflict_answer(&reach, meta)),
    Saved::Missing => Err(ApiError::not_found(format!("No note {id} stands."))),
    Saved::Trashed => Err(ApiError::trashed(&id)),
  }
}

async fn delete_note(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<DeleteQuery>, QueryRejection>,
) -> Answer<Response> {
  let DeleteQuery { purge, owner } = query(given)?;
  let reach = reach(&app, &headers, owner, &id)?;
  reach.owns()?;
  let owner = reach.owner;
  if purge.unwrap_or(false) {
    // Whoever the note was shared with hears of its going, before the purge takes the shares.
    let audience = audience(&app, &owner, &id);
    let purged = app.store.purge(&owner, &id).map_err(ApiError::failed)?;
    if !purged {
      return Err(match app.store.meta(&owner, &id, Some(false)).map_err(ApiError::failed)? {
        Some(_) => ApiError::not_trashed(&id),
        None => ApiError::not_found(format!("No note {id} stands.")),
      });
    }
    publish_note(&app, "note.purged", &owner, &id, audience);
    return Ok(StatusCode::NO_CONTENT.into_response());
  }
  let trashed = app.store.trash(&owner, &id, now_ms()).map_err(ApiError::failed)?;
  match trashed {
    Some(_) => {
      publish_note(&app, "note.trashed", &owner, &id, audience(&app, &owner, &id));
      Ok(StatusCode::NO_CONTENT.into_response())
    }
    // Already in the trash: the note stands where the call would have moved it.
    None if app.store.meta(&owner, &id, Some(true)).map_err(ApiError::failed)?.is_some() => {
      Ok(StatusCode::NO_CONTENT.into_response())
    }
    None => Err(ApiError::not_found(format!("No note {id} stands."))),
  }
}

/// A conflict answered with the note as it stands, as a save's is.
fn conflict_answer(reach: &Reach, meta: NoteMeta) -> Response {
  let error = ApiError::version_conflict(format!("The note stands at version {}.", meta.version));
  let mut response = Json(serde_json::json!({
    "code": error.code,
    "error": error.error,
    "note": reach.held(meta),
  }))
  .into_response();
  *response.status_mut() = StatusCode::CONFLICT;
  response
}

/// A write beside the document answered: the note as it stands, or why it did not land.
fn written_answer(reach: &Reach, id: &str, written: Written) -> Answer<Response> {
  match written {
    Written::Done(meta) => Ok(json_answer(StatusCode::OK, reach.held(meta))),
    Written::Conflict(meta) => Ok(conflict_answer(reach, meta)),
    Written::Missing => Err(ApiError::not_found(format!("No note {id} stands."))),
    Written::Trashed => Err(ApiError::trashed(id)),
  }
}

async fn write_text(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let reach = reach(&app, &headers, query(given_query)?.owner, &id)?;
  reach.writes()?;
  let given: NoteText = body(&bytes)?;
  let text = clean_text(&given.text, app.settings.notes.max_doc_bytes)?;
  let written = app.store.set_text(&reach.owner, &id, given.version, &text).map_err(ApiError::failed)?;
  written_answer(&reach, &id, written)
}

async fn write_icon(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let reach = reach(&app, &headers, query(given_query)?.owner, &id)?;
  reach.writes()?;
  let given: NoteIcon = body(&bytes)?;
  let icon = clean_icon(&given.icon)?;
  let written = app.store.set_icon(&reach.owner, &id, &icon).map_err(ApiError::failed)?;
  if matches!(written, Written::Done(_)) {
    publish_note(&app, "note.saved", &reach.owner, &id, audience(&app, &reach.owner, &id));
  }
  written_answer(&reach, &id, written)
}

async fn duplicate_note(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let reach = reach(&app, &headers, query(given_query)?.owner, &id)?;
  let given: NewCopy = body(&bytes)?;
  let copy = match given.id.as_deref() {
    Some(copy) if makeable_id(copy) => copy.to_owned(),
    Some(_) => {
      return Err(ApiError::bad_request(
        "The id is not 1 to 64 letters, digits, - and _, or names a route.",
      ));
    }
    None => fresh_id(),
  };
  let title = clean_title(&given.title)?;
  let copied = app
    .store
    .duplicate(&reach.owner, &id, &reach.account, &copy, &title, now_ms())
    .map_err(ApiError::failed)?;
  match copied {
    Copied::Made(meta) => {
      publish_note(&app, "note.saved", &reach.account, &copy, vec![reach.account.clone()]);
      Ok(json_answer(StatusCode::CREATED, meta))
    }
    Copied::Missing => Err(ApiError::not_found(format!("No note {id} stands live."))),
    Copied::Taken => Err(ApiError::bad_request(format!("The caller already holds a note at {copy}."))),
  }
}

// ---------------------------------------------------------------------------------------------------------
// The images of a note

async fn put_blob(
  State(app): State<Arc<App>>,
  Path((note, id)): Path<(String, String)>,
  given: Result<Query<NoteQuery>, QueryRejection>,
  request: Request,
) -> Answer<Response> {
  let headers = request.headers().clone();
  let reach = reach(&app, &headers, query(given)?.owner, &note)?;
  reach.writes()?;
  if !valid_blob_id(&id) {
    return Err(ApiError::bad_request("The blob id is not 1 to 128 letters, digits, -, _ and =."));
  }
  let mime = header_text(&headers, header::CONTENT_TYPE.as_str()).unwrap_or("");
  if !mime.starts_with("image/") {
    return Err(ApiError::bad_request("The body must name its type as an image."));
  }
  match app.store.meta(&reach.owner, &note, Some(false)).map_err(ApiError::failed)? {
    Some(_) => {}
    None if app.store.meta(&reach.owner, &note, Some(true)).map_err(ApiError::failed)?.is_some() => {
      return Err(ApiError::trashed(&note));
    }
    None => return Err(ApiError::not_found(format!("No note {note} stands."))),
  }
  // The body is read here, at the cap, so a store of the note's own account sees no more than the
  // cap's bytes and the refusal carries the store's code whatever the call declared.
  let max = app.settings.notes.max_blob_bytes;
  let bytes = axum::body::to_bytes(request.into_body(), max)
    .await
    .map_err(|_| ApiError::too_large(max))?;
  app
    .store
    .put_blob(&reach.owner, &note, &id, mime, &bytes, now_ms())
    .map_err(ApiError::failed)?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

async fn read_blob(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((note, id)): Path<(String, String)>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let reach = reach(&app, &headers, query(given)?.owner, &note)?;
  blob_answer(&app, &reach.owner, &note, &id)
}

/// One stored image as the image routes answer it, the note's own and the share read alike.
pub(crate) fn blob_answer(app: &App, owner: &str, note: &str, id: &str) -> Answer<Response> {
  let (mime, bytes) = app
    .store
    .blob(owner, note, id)
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found(format!("No image {id} stands with note {note}.")))?;
  Ok(
    (
      StatusCode::OK,
      [(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, KEPT_FOR_GOOD.to_owned())],
      bytes,
    )
      .into_response(),
  )
}

pub(crate) fn json_answer(status: StatusCode, value: impl serde::Serialize) -> Response {
  (status, Json(value)).into_response()
}

// ---------------------------------------------------------------------------------------------------------
// The events the note service publishes

fn sent(event: &StreamEvent) -> Sent {
  Sent::default()
    .event(event.kind.clone())
    .id(event.id.to_string())
    .data(serde_json::to_string(&event).unwrap_or_default())
}

fn visible(caller: &Caller, service: bool, record: &Record) -> bool {
  service || record.reaches(&caller.owner)
}

async fn events(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given: Result<Query<EventsQuery>, QueryRejection>,
) -> Answer<Response> {
  let given = query(given)?;
  let caller = stream_caller(&app, &headers)?;
  let service = caller.service;
  let resumed = header_text(&headers, "last-event-id").and_then(|id| id.parse::<i64>().ok());
  let after = resumed.or(given.after);
  let kinds: Option<Vec<String>> = given
    .kinds
    .as_deref()
    .map(|kinds| kinds.split(',').map(str::trim).map(str::to_owned).collect());
  let keep = move |record: &Record| {
    let kind_wanted = kinds.as_ref().is_none_or(|kinds| kinds.contains(&record.event.kind));
    kind_wanted && visible(&caller, service, record)
  };
  let paged = header_text(&headers, "accept").is_some_and(|accepted| accepted.contains("application/json"));
  if paged {
    let limit = limit_of(given.limit)?;
    let (records, gone) = app.events.after(after.unwrap_or(app.events.first()));
    if gone && after.is_some() {
      return Err(ApiError::gone("The events after that number are no longer kept; read the notes again."));
    }
    let records: Vec<_> = records.into_iter().filter(|record| keep(record)).collect();
    let more = records.len() > limit as usize;
    let items = records.into_iter().take(limit as usize).map(|record| record.event).collect();
    return Ok(Json(Page::<StreamEvent> { items, more }).into_response());
  }
  let live = app.events.subscribe();
  let backlog = match after {
    Some(after) => {
      let (records, gone) = app.events.after(after);
      if gone {
        return Err(ApiError::gone(
          "The events after that number are no longer kept; read the notes again.",
        ));
      }
      records
    }
    None => Vec::new(),
  };
  let cursor = backlog
    .last()
    .map(|record| record.event.id)
    .or(after)
    .unwrap_or_else(|| app.events.latest());
  let backlog = stream::iter(backlog);
  let live = stream::unfold((live, cursor), |(mut live, cursor)| async move {
    loop {
      match live.recv().await {
        Ok(record) if record.event.id > cursor => {
          let id = record.event.id;
          return Some((record, (live, id)));
        }
        Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
        Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
      }
    }
  });
  let stream = backlog
    .chain(live)
    .filter(move |record| std::future::ready(keep(record)))
    .map(|record| Ok::<_, Infallible>(sent(&record.event)))
    .take_until(app.events.stopped());
  Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(KEEP_OPEN)).into_response())
}
