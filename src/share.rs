//! The sharing routes (`docs/api.md`, 「Sharing」): a note's one link and the accounts it is shared with,
//! each the owner's alone to read and change, and the share reads a link's token opens with no account.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, patch};

use crate::api::{Answer, Reach, blob_answer, body, credential, json_answer, query, reach};
use crate::app::App;
use crate::error::ApiError;
use crate::model::{KEY_MAX, encode_doc, fresh_token, now_ms};
use crate::wire::{
  Link, Member, MemberChange, NewLink, NewMembers, NoteMeta, NoteQuery, Page, Permission, ShareEvent,
  SharedNote,
};

/// The most accounts one share names.
const USERS_MAX: usize = 100;

/// The sharing routes and the share reads, which the screens call.
pub fn routes() -> Router<Arc<App>> {
  Router::new()
    .route("/notes/{noteId}/link", get(read_link).post(make_link).delete(end_link))
    .route("/notes/{noteId}/members", get(read_members).post(add_members))
    .route("/notes/{noteId}/members/{user}", patch(change_member).delete(remove_member))
    .route("/shares/{token}", get(shared_note))
    .route("/shares/{token}/blobs/{blobId}", get(shared_blob))
}

/// The caller's own note `id`, as the sharing routes reach it: a member is refused, and a note the caller
/// does not hold is not found. Answers the reach and the note as it stands, live or trashed.
fn owned(app: &App, headers: &HeaderMap, owner: Option<String>, id: &str) -> Answer<(Reach, NoteMeta)> {
  let reach = reach(app, headers, owner, id)?;
  reach.owns()?;
  let live = app.store.meta(&reach.owner, id, Some(false)).map_err(ApiError::failed)?;
  let meta = match live {
    Some(meta) => meta,
    None => app
      .store
      .meta(&reach.owner, id, Some(true))
      .map_err(ApiError::failed)?
      .ok_or_else(|| ApiError::not_found(format!("No note {id} stands.")))?,
  };
  Ok((reach, meta))
}

/// Refuses a write on a note standing in the trash.
fn live(meta: &NoteMeta) -> Answer<()> {
  match meta.deleted_at {
    Some(_) => Err(ApiError::trashed(&meta.id)),
    None => Ok(()),
  }
}

fn publish_share(
  app: &App,
  kind: &str,
  owner: &str,
  note: &str,
  member: &str,
  permission: Option<Permission>,
) {
  let data = ShareEvent {
    note_id: note.to_owned(),
    owner: owner.to_owned(),
    member: member.to_owned(),
    permission,
  };
  app.events.publish(kind, data, vec![owner.to_owned(), member.to_owned()]);
}

// ---------------------------------------------------------------------------------------------------------
// The link

async fn read_link(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Json<Link>> {
  let (reach, _) = owned(&app, &headers, query(given)?.owner, &id)?;
  let link = app.store.link(&reach.owner, &id, now_ms()).map_err(ApiError::failed)?;
  link
    .map(Json)
    .ok_or_else(|| ApiError::not_found(format!("No link stands for note {id}.")))
}

async fn make_link(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let (reach, meta) = owned(&app, &headers, query(given)?.owner, &id)?;
  live(&meta)?;
  let given: NewLink = if bytes.is_empty() { NewLink::default() } else { body(&bytes)? };
  let now = now_ms();
  if given.expires_at.is_some_and(|end| end <= now) {
    return Err(ApiError::bad_request("expiresAt is a moment in the future."));
  }
  let token = fresh_token().map_err(ApiError::failed)?;
  let (link, made) = app
    .store
    .make_link(&reach.owner, &id, &token, given.expires_at, now)
    .map_err(ApiError::failed)?;
  let status = if made { StatusCode::CREATED } else { StatusCode::OK };
  Ok(json_answer(status, link))
}

async fn end_link(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let (reach, _) = owned(&app, &headers, query(given)?.owner, &id)?;
  app.store.end_link(&reach.owner, &id).map_err(ApiError::failed)?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

// ---------------------------------------------------------------------------------------------------------
// The members

async fn read_members(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Json<Page<Member>>> {
  let (reach, _) = owned(&app, &headers, query(given)?.owner, &id)?;
  let items = app.store.members(&reach.owner, &id).map_err(ApiError::failed)?;
  Ok(Json(Page { items, more: false }))
}

/// The account keys a share names, trimmed and each named once; refused where none is named, too many
/// are, one is out of bounds, or one is the owner's own.
fn users_of(given: &[String], owner: &str) -> Answer<Vec<String>> {
  let mut users: Vec<String> = Vec::new();
  for user in given.iter().map(|user| user.trim()) {
    if user.is_empty() || user.chars().count() > KEY_MAX {
      return Err(ApiError::bad_request(format!("An account key is 1 to {KEY_MAX} characters.")));
    }
    if user == owner {
      return Err(ApiError::bad_request("A note is not shared with its own owner."));
    }
    if !users.iter().any(|one| one == user) {
      users.push(user.to_owned());
    }
  }
  if users.is_empty() || users.len() > USERS_MAX {
    return Err(ApiError::bad_request(format!("users names 1 to {USERS_MAX} account keys.")));
  }
  Ok(users)
}

async fn add_members(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Json<Page<Member>>> {
  let (reach, meta) = owned(&app, &headers, query(given_query)?.owner, &id)?;
  live(&meta)?;
  let given: NewMembers = body(&bytes)?;
  let users = users_of(&given.users, &reach.owner)?;
  let items = app
    .store
    .share(&reach.owner, &id, &users, given.permission, now_ms())
    .map_err(ApiError::failed)?;
  for user in &users {
    publish_share(&app, "note.shared", &reach.owner, &id, user, Some(given.permission));
  }
  Ok(Json(Page { items, more: false }))
}

async fn change_member(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((id, user)): Path<(String, String)>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Json<Member>> {
  let (reach, meta) = owned(&app, &headers, query(given_query)?.owner, &id)?;
  live(&meta)?;
  let given: MemberChange = body(&bytes)?;
  let member = app
    .store
    .change_member(&reach.owner, &id, &user, given.permission)
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found(format!("Note {id} is not shared with {user}.")))?;
  publish_share(&app, "note.shared", &reach.owner, &id, &user, Some(given.permission));
  Ok(Json(member))
}

async fn remove_member(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((id, user)): Path<(String, String)>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let (reach, _) = owned(&app, &headers, query(given)?.owner, &id)?;
  if app.store.unshare(&reach.owner, &id, &user).map_err(ApiError::failed)? {
    publish_share(&app, "note.unshared", &reach.owner, &id, &user, None);
  }
  Ok(StatusCode::NO_CONTENT.into_response())
}

// ---------------------------------------------------------------------------------------------------------
// The share reads

/// The owner and the note a live link's token opens, under either credential; anything else is not found.
fn opened(app: &App, headers: &HeaderMap, token: &str) -> Answer<(crate::store::Row, Option<i64>)> {
  credential(app, headers)?;
  app
    .store
    .opened(token, now_ms())
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found("No shared note stands at that link."))
}

async fn shared_note(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(token): Path<String>,
) -> Answer<Json<SharedNote>> {
  let (row, expires_at) = opened(&app, &headers, &token)?;
  Ok(Json(SharedNote {
    doc: encode_doc(&row.doc),
    id: row.meta.id,
    title: row.meta.title,
    changed_at: row.meta.changed_at,
    size: row.meta.size,
    expires_at,
  }))
}

async fn shared_blob(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((token, id)): Path<(String, String)>,
) -> Answer<Response> {
  let (row, _) = opened(&app, &headers, &token)?;
  blob_answer(&app, &row.meta.owner, &row.meta.id, &id)
}
