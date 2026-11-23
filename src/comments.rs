//! A note's comment threads (`docs/api.md`, 「Comments」, `docs/design.md`, 「Comments」): read by whoever
//! reads the note, started, replied to, resolved and reopened by whoever writes it, and deleted by their
//! author or the note's owner. A thread is anchored by the comment marks the note's document carries of its
//! id; the service reads which ones stand from the stored document.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{delete, get, patch, post};

use crate::api::{Answer, Reach, audience, body, json_answer, query, reach};
use crate::app::App;
use crate::doc::{parsed, threads as marked};
use crate::error::ApiError;
use crate::model::{clean_comment, clean_quote, now_ms, valid_id};
use crate::wire::{
  Access, CommentEvent, NewComment, NewThread, NoteMeta, NoteQuery, Page, Thread, ThreadChange,
};

/// The routes of a note's threads and their comments.
pub fn routes() -> Router<Arc<App>> {
  Router::new()
    .route("/notes/{noteId}/threads", get(read_threads).post(start_thread))
    .route("/notes/{noteId}/threads/{threadId}", patch(change_thread).delete(delete_thread))
    .route("/notes/{noteId}/threads/{threadId}/comments", post(reply))
    .route("/notes/{noteId}/threads/{threadId}/comments/{commentId}", delete(delete_comment))
}

/// The note a comment route reaches and its stored state: a member reads it while it lives, the owner
/// wherever it stands; nothing else stands.
fn reached(
  app: &App,
  headers: &HeaderMap,
  owner: Option<String>,
  id: &str,
) -> Answer<(Reach, NoteMeta, Vec<u8>)> {
  let reach = reach(app, headers, owner, id)?;
  let row = app
    .store
    .note(&reach.owner, id, Some(false))
    .map_err(ApiError::failed)?
    .or(if reach.access == Access::Owner {
      app.store.note(&reach.owner, id, Some(true)).map_err(ApiError::failed)?
    } else {
      None
    })
    .ok_or_else(|| ApiError::not_found(format!("No note {id} stands.")))?;
  Ok((reach, row.meta, row.doc))
}

/// Refuses a write on a note in the trash, and a caller whose share opens no writes.
fn writable(reach: &Reach, meta: &NoteMeta) -> Answer<()> {
  reach.writes()?;
  match meta.deleted_at {
    Some(_) => Err(ApiError::trashed(&meta.id)),
    None => Ok(()),
  }
}

/// Whether the note's stored document carries a mark of each thread.
fn anchoring(doc: &[u8]) -> impl Fn(&str) -> bool + use<> {
  let marks = parsed(doc).map(|doc| marked(&doc)).unwrap_or_default();
  move |thread: &str| marks.contains(thread)
}

fn publish(app: &App, reach: &Reach, note: &str, thread: &str) {
  let data = CommentEvent {
    note_id: note.to_owned(),
    owner: reach.owner.clone(),
    thread: thread.to_owned(),
  };
  app.events.publish("note.commented", data, audience(app, &reach.owner, note));
}

async fn read_threads(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Json<Page<Thread>>> {
  let (reach, _, doc) = reached(&app, &headers, query(given)?.owner, &id)?;
  let items = app.store.threads(&reach.owner, &id, &anchoring(&doc)).map_err(ApiError::failed)?;
  Ok(Json(Page { items, more: false }))
}

async fn start_thread(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let (reach, meta, doc) = reached(&app, &headers, query(given_query)?.owner, &id)?;
  writable(&reach, &meta)?;
  let given: NewThread = body(&bytes)?;
  if !valid_id(&given.id) {
    return Err(ApiError::bad_request("A thread id is 1 to 64 letters, digits, - and _."));
  }
  let quote = clean_quote(&given.quote)?;
  let words = clean_comment(&given.body)?;
  let (mut thread, made) = app
    .store
    .start_thread(&reach.owner, &id, &given.id, &quote, &reach.account, &words, now_ms())
    .map_err(ApiError::failed)?;
  thread.anchored = anchoring(&doc)(&thread.id);
  if made {
    publish(&app, &reach, &id, &thread.id);
  }
  Ok(json_answer(if made { StatusCode::CREATED } else { StatusCode::OK }, thread))
}

async fn reply(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((id, thread)): Path<(String, String)>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let (reach, meta, _) = reached(&app, &headers, query(given_query)?.owner, &id)?;
  writable(&reach, &meta)?;
  let given: NewComment = body(&bytes)?;
  let words = clean_comment(&given.body)?;
  let comment = app
    .store
    .reply(&reach.owner, &id, &thread, &reach.account, &words, now_ms())
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found(format!("No thread {thread} stands on note {id}.")))?;
  publish(&app, &reach, &id, &thread);
  Ok(json_answer(StatusCode::CREATED, comment))
}

async fn change_thread(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((id, thread)): Path<(String, String)>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Json<Thread>> {
  let (reach, meta, doc) = reached(&app, &headers, query(given_query)?.owner, &id)?;
  writable(&reach, &meta)?;
  let given: ThreadChange = body(&bytes)?;
  let mut changed = app
    .store
    .resolve(&reach.owner, &id, &thread, given.resolved, &reach.account, now_ms())
    .map_err(ApiError::failed)?
    .ok_or_else(|| ApiError::not_found(format!("No thread {thread} stands on note {id}.")))?;
  changed.anchored = anchoring(&doc)(&changed.id);
  publish(&app, &reach, &id, &thread);
  Ok(Json(changed))
}

async fn delete_thread(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((id, thread)): Path<(String, String)>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let (reach, meta, _) = reached(&app, &headers, query(given)?.owner, &id)?;
  writable(&reach, &meta)?;
  let Some(standing) = app.store.thread(&reach.owner, &id, &thread).map_err(ApiError::failed)? else {
    return Ok(StatusCode::NO_CONTENT.into_response());
  };
  if reach.access != Access::Owner && standing.author != reach.account {
    return Err(ApiError::forbidden("Only the thread's author or the note's owner deletes it."));
  }
  if app.store.delete_thread(&reach.owner, &id, &thread).map_err(ApiError::failed)? {
    publish(&app, &reach, &id, &thread);
  }
  Ok(StatusCode::NO_CONTENT.into_response())
}

async fn delete_comment(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path((id, thread, comment)): Path<(String, String, String)>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let (reach, meta, _) = reached(&app, &headers, query(given)?.owner, &id)?;
  writable(&reach, &meta)?;
  let standing = app.store.thread(&reach.owner, &id, &thread).map_err(ApiError::failed)?;
  let Some(written) =
    standing.and_then(|standing| standing.comments.into_iter().find(|one| one.id == comment))
  else {
    return Ok(StatusCode::NO_CONTENT.into_response());
  };
  if reach.access != Access::Owner && written.author != reach.account {
    return Err(ApiError::forbidden("Only the comment's author or the note's owner deletes it."));
  }
  if app
    .store
    .delete_comment(&reach.owner, &id, &thread, &comment)
    .map_err(ApiError::failed)?
  {
    publish(&app, &reach, &id, &thread);
  }
  Ok(StatusCode::NO_CONTENT.into_response())
}
