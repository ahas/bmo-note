//! The routes (`docs/api.md`): who calls (the service token or the console's credential with the reader's
//! key and role), the notes, the event stream, the console bundle and the health.

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
use axum::routing::get;
use futures_util::{StreamExt, stream};
use serde::de::DeserializeOwned;

use crate::app::App;
use crate::console::{Bundle, KEPT_FOR_GOOD, MANIFEST_PATH, WORDS_PATH};
use crate::error::ApiError;
use crate::events::Record;
use crate::model::{
  clean_title, decode_doc, encode_doc, fresh_id, now_ms, parse_cursor, valid_blob_id, valid_id,
};
use crate::store::Saved;
use crate::wire::{
  DeleteQuery, EventsQuery, Health, NewNote, Note, NoteEvent, NoteMeta, NoteQuery, NoteSave, NotesQuery,
  Page, StreamEvent,
};

/// The most rows and events one page holds.
pub const PAGE_MAX: i64 = 200;

/// How often a comment line keeps a stream open.
const KEEP_OPEN: StdDuration = StdDuration::from_secs(15);

type Answer<T> = Result<T, ApiError>;

/// The service as the routes see it: its state and its console bundle, where one is built.
#[derive(Clone)]
pub struct Served {
  pub app: Arc<App>,
  pub bundle: Option<Arc<Bundle>>,
}

/// Every route, the unknown ones answered `no-route`.
pub fn router(served: Served) -> Router {
  Router::new()
    .route(MANIFEST_PATH, get(manifest))
    .route(WORDS_PATH, get(words))
    .route("/console/{*file}", get(console_file))
    .route("/health", get(health))
    .route("/events", get(events))
    .route("/notes", get(list_notes).post(create_note))
    .route("/notes/{noteId}", get(read_note).patch(save_note).delete(delete_note))
    .route("/notes/{noteId}/blobs/{blobId}", get(read_blob).put(put_blob))
    .fallback(|| async { ApiError::no_route() })
    .method_not_allowed_fallback(|| async { ApiError::no_route() })
    .with_state(served)
}

/// Who calls.
#[derive(Clone, Debug)]
struct Caller {
  /// The service token's caller, rather than the console's.
  service: bool,
  /// The account the call answers for: the reader's key, or the service token's `owner`.
  owner: String,
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
fn credential(app: &App, headers: &HeaderMap) -> Answer<bool> {
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

/// The console's credential alone, as the console bundle's own routes take it (401 for any other).
fn console_credential(app: &App, headers: &HeaderMap) -> Answer<()> {
  match credential(app, headers)? {
    false => Ok(()),
    true => Err(ApiError::unauthorized()),
  }
}

/// The account a route of the screens answers for: the reader's key on a console call, the named
/// `owner` on a service-token call.
fn caller(app: &App, headers: &HeaderMap, owner: Option<String>) -> Answer<Caller> {
  if credential(app, headers)? {
    let owner = owner.map(|owner| owner.trim().to_owned()).filter(|owner| !owner.is_empty());
    let owner = owner.ok_or_else(ApiError::no_owner)?;
    if owner.chars().count() > 200 {
      return Err(ApiError::no_owner());
    }
    return Ok(Caller {
      service: true,
      owner,
    });
  }
  let key = header_text(headers, "owner-key")
    .ok_or_else(|| ApiError::forbidden("The call carries no Owner-Key."))?;
  if key.chars().count() > 200 {
    return Err(ApiError::forbidden("The Owner-Key is longer than 200 characters."));
  }
  match header_text(headers, "owner-role") {
    Some("administrator") | Some("member") => {}
    _ => return Err(ApiError::forbidden("The call carries no Owner-Role of administrator or member.")),
  }
  Ok(Caller {
    service: false,
    owner: key.to_owned(),
  })
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

fn query<T: DeserializeOwned>(given: Result<Query<T>, QueryRejection>) -> Answer<T> {
  given.map(|Query(query)| query).map_err(|why| ApiError::bad_request(why.body_text()))
}

fn body<T: DeserializeOwned>(bytes: &Bytes) -> Answer<T> {
  serde_json::from_slice(bytes)
    .map_err(|why| ApiError::bad_request(format!("The body does not read: {why}")))
}

// ---------------------------------------------------------------------------------------------------------
// Health

async fn health(State(served): State<Served>, headers: HeaderMap) -> Answer<Json<Health>> {
  credential(&served.app, &headers)?;
  Ok(Json(Health {
    ready: true,
    reason: None,
    version: env!("CARGO_PKG_VERSION").to_owned(),
  }))
}

// ---------------------------------------------------------------------------------------------------------
// The notes

fn limit_of(given: Option<i64>) -> Answer<i64> {
  let limit = given.unwrap_or(50);
  if !(1..=PAGE_MAX).contains(&limit) {
    return Err(ApiError::bad_request(format!("limit is 1 to {PAGE_MAX}")));
  }
  Ok(limit)
}

async fn list_notes(
  State(served): State<Served>,
  headers: HeaderMap,
  given: Result<Query<NotesQuery>, QueryRejection>,
) -> Answer<Json<Page<NoteMeta>>> {
  let given = query(given)?;
  let caller = caller(&served.app, &headers, given.owner)?;
  let limit = limit_of(given.limit)?;
  let after = match given.after.as_deref().map(parse_cursor) {
    None => None,
    Some(None) => {
      return Err(ApiError::bad_request("after is the changedAt:id of a row, joined by one colon."));
    }
    Some(Some(cursor)) => Some(cursor),
  };
  let (items, more) = served
    .app
    .store
    .list(&caller.owner, given.deleted.unwrap_or(false), after, limit)
    .map_err(ApiError::failed)?;
  Ok(Json(Page { items, more }))
}

async fn create_note(
  State(served): State<Served>,
  headers: HeaderMap,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let caller = caller(&served.app, &headers, query(given_query)?.owner)?;
  let given: NewNote = body(&bytes)?;
  let id = match given.id.as_deref() {
    Some(id) if valid_id(id) => id.to_owned(),
    Some(_) => return Err(ApiError::bad_request("The id is not 1 to 64 letters, digits, - and _..")),
    None => fresh_id(),
  };
  let title = clean_title(&given.title)?;
  let doc = decode_doc(&given.doc, served.app.settings.notes.max_doc_bytes)?;
  let at = now_ms();
  let (meta, made) = served
    .app
    .store
    .create(&caller.owner, &id, &title, &doc, at)
    .map_err(ApiError::failed)?;
  if made {
    served.app.events.publish(
      "note.saved",
      NoteEvent {
        note_id: id.clone(),
        owner: caller.owner.clone(),
      },
      &caller.owner,
    );
  }
  let status = if made { StatusCode::CREATED } else { StatusCode::OK };
  Ok(json_answer(status, meta))
}

async fn read_note(
  State(served): State<Served>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Json<Note>> {
  let caller = caller(&served.app, &headers, query(given)?.owner)?;
  let row = served
    .app
    .store
    .note(&caller.owner, &id, Some(false))
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found(format!("No note {id} stands live.")))?;
  Ok(Json(Note {
    doc: encode_doc(&row.doc),
    meta: row.meta,
  }))
}

async fn save_note(
  State(served): State<Served>,
  headers: HeaderMap,
  Path(id): Path<String>,
  bytes: Bytes,
) -> Answer<Response> {
  let caller = caller(&served.app, &headers, None)?;
  let given: NoteSave = body(&bytes)?;
  if given.version < 1 {
    return Err(ApiError::bad_request("version is a whole number from 1."));
  }
  let title = given.title.as_deref().map(clean_title).transpose()?;
  let doc = given
    .doc
    .as_deref()
    .map(|doc| decode_doc(doc, served.app.settings.notes.max_doc_bytes))
    .transpose()?;
  let restore = given.restore.unwrap_or(false);
  let at = now_ms();
  let saved = served
    .app
    .store
    .save(&caller.owner, &id, title.as_deref(), doc.as_deref(), given.version, restore, at)
    .map_err(ApiError::failed)?;
  match saved {
    Saved::Unchanged(meta) => Ok(json_answer(StatusCode::OK, meta)),
    Saved::Saved(meta) => {
      served.app.events.publish(
        "note.saved",
        NoteEvent {
          note_id: id.clone(),
          owner: caller.owner.clone(),
        },
        &caller.owner,
      );
      Ok(json_answer(StatusCode::OK, meta))
    }
    Saved::Restored(meta) => {
      served.app.events.publish(
        "note.restored",
        NoteEvent {
          note_id: id.clone(),
          owner: caller.owner.clone(),
        },
        &caller.owner,
      );
      Ok(json_answer(StatusCode::OK, meta))
    }
    Saved::Conflict(meta) => {
      let error = ApiError::version_conflict(format!("The note stands at version {}.", meta.version));
      let mut response = Json(serde_json::json!({
        "code": error.code,
        "error": error.error,
        "note": meta,
      }))
      .into_response();
      *response.status_mut() = StatusCode::CONFLICT;
      Ok(response)
    }
    Saved::Missing => Err(ApiError::not_found(format!("No note {id} stands."))),
    Saved::Trashed => Err(ApiError::trashed(&id)),
  }
}

async fn delete_note(
  State(served): State<Served>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<DeleteQuery>, QueryRejection>,
) -> Answer<Response> {
  let DeleteQuery { purge, owner } = query(given)?;
  let caller = caller(&served.app, &headers, owner)?;
  if purge.unwrap_or(false) {
    let purged = served.app.store.purge(&caller.owner, &id).map_err(ApiError::failed)?;
    if !purged {
      return Err(
        match served.app.store.meta(&caller.owner, &id, Some(false)).map_err(ApiError::failed)? {
          Some(_) => ApiError::not_trashed(&id),
          None => ApiError::not_found(format!("No note {id} stands.")),
        },
      );
    }
    served.app.events.publish(
      "note.purged",
      NoteEvent {
        note_id: id.clone(),
        owner: caller.owner.clone(),
      },
      &caller.owner,
    );
    return Ok(StatusCode::NO_CONTENT.into_response());
  }
  let trashed = served.app.store.trash(&caller.owner, &id, now_ms()).map_err(ApiError::failed)?;
  match trashed {
    Some(_) => {
      served.app.events.publish(
        "note.trashed",
        NoteEvent {
          note_id: id.clone(),
          owner: caller.owner.clone(),
        },
        &caller.owner,
      );
      Ok(StatusCode::NO_CONTENT.into_response())
    }
    // Already in the trash: the note stands where the call would have moved it.
    None
      if served
        .app
        .store
        .meta(&caller.owner, &id, Some(true))
        .map_err(ApiError::failed)?
        .is_some() =>
    {
      Ok(StatusCode::NO_CONTENT.into_response())
    }
    None => Err(ApiError::not_found(format!("No note {id} stands."))),
  }
}

// ---------------------------------------------------------------------------------------------------------
// The images of a note

async fn put_blob(
  State(served): State<Served>,
  Path((note, id)): Path<(String, String)>,
  given: Result<Query<NoteQuery>, QueryRejection>,
  request: Request,
) -> Answer<Response> {
  let headers = request.headers().clone();
  let caller = caller(&served.app, &headers, query(given)?.owner)?;
  if !valid_blob_id(&id) {
    return Err(ApiError::bad_request("The blob id is not 1 to 128 letters, digits, -, _ and =."));
  }
  let mime = header_text(&headers, header::CONTENT_TYPE.as_str()).unwrap_or("");
  if !mime.starts_with("image/") {
    return Err(ApiError::bad_request("The body must name its type as an image."));
  }
  match served.app.store.meta(&caller.owner, &note, Some(false)).map_err(ApiError::failed)? {
    Some(_) => {}
    None
      if served
        .app
        .store
        .meta(&caller.owner, &note, Some(true))
        .map_err(ApiError::failed)?
        .is_some() =>
    {
      return Err(ApiError::trashed(&note));
    }
    None => return Err(ApiError::not_found(format!("No note {note} stands."))),
  }
  // The body is read here, at the cap, so a store of the note's own account sees no more than the
  // cap's bytes and the refusal carries the store's code whatever the call declared.
  let max = served.app.settings.notes.max_blob_bytes;
  let bytes = axum::body::to_bytes(request.into_body(), max)
    .await
    .map_err(|_| ApiError::too_large(max))?;
  served
    .app
    .store
    .put_blob(&caller.owner, &note, &id, mime, &bytes, now_ms())
    .map_err(ApiError::failed)?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

async fn read_blob(
  State(served): State<Served>,
  headers: HeaderMap,
  Path((note, id)): Path<(String, String)>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let caller = caller(&served.app, &headers, query(given)?.owner)?;
  let (mime, bytes) = served
    .app
    .store
    .blob(&caller.owner, &note, &id)
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

fn json_answer(status: StatusCode, value: impl serde::Serialize) -> Response {
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
  service || record.owner == caller.owner
}

async fn events(
  State(served): State<Served>,
  headers: HeaderMap,
  given: Result<Query<EventsQuery>, QueryRejection>,
) -> Answer<Response> {
  let app = Arc::clone(&served.app);
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

// ---------------------------------------------------------------------------------------------------------
// The console bundle

fn built(served: &Served) -> Answer<Arc<Bundle>> {
  served
    .bundle
    .clone()
    .ok_or_else(|| ApiError::not_found("The console bundle is not built here."))
}

// The manifest and the words, which the console reads for no reader.
async fn manifest(State(served): State<Served>, headers: HeaderMap) -> Answer<Response> {
  console_credential(&served.app, &headers)?;
  Ok(Json(built(&served)?.manifest()).into_response())
}

async fn words(State(served): State<Served>, headers: HeaderMap) -> Answer<Response> {
  console_credential(&served.app, &headers)?;
  Ok(Json(built(&served)?.words.clone()).into_response())
}

// The module, the stylesheet and the build's other files, held to the reader's key and role as every
// route of the screens is.
async fn console_file(
  State(served): State<Served>,
  headers: HeaderMap,
  Path(name): Path<String>,
) -> Answer<Response> {
  console_credential(&served.app, &headers)?;
  caller(&served.app, &headers, None)?;
  let served_bundle = built(&served)?;
  // The name is the bundle's own built path: one of the two digested files, or a chunk or font the
  // module pulls by them. A name that walks outside the folder is simply not there.
  if name.split('/').any(|segment| segment.is_empty() || segment == "." || segment == "..") {
    return Err(ApiError::not_found("No bundle file answers that name."));
  }
  let (content_type, bytes) = match served_bundle.file(&name) {
    Some(file) => (file.content_type, file.bytes.clone()),
    None => match served_bundle.other(&name) {
      Some(other) => (other.content_type, other.bytes.clone()),
      None => return Err(ApiError::not_found(format!("The bundle holds no {name}."))),
    },
  };
  Ok(
    (
      StatusCode::OK,
      [(header::CONTENT_TYPE, content_type), (header::CACHE_CONTROL, KEPT_FOR_GOOD)],
      bytes,
    )
      .into_response(),
  )
}
