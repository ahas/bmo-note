//! Each account's folders and the place of its notes among them (`docs/api.md`, 「Folders」;
//! `docs/design.md`, 「Folders」): a folder is its owner's own arrangement, so every route here answers the
//! calling account alone, and a note is moved by its owner alone.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, patch, put};

use crate::api::{Answer, Caller, body, caller, json_answer, query, reach};
use crate::app::App;
use crate::error::ApiError;
use crate::model::{clean_folder_name, fresh_id, now_ms, valid_id};
use crate::store::Filed;
use crate::wire::{FiledEvent, Folder, FolderChange, FolderEvent, NewFolder, NoteFiling, NoteQuery, Page};

/// The routes of the folders and of a note's place among them.
pub fn routes() -> Router<Arc<App>> {
  Router::new()
    .route("/folders", get(list_folders).post(make_folder))
    .route("/folders/{folderId}", patch(change_folder).delete(delete_folder))
    .route("/notes/{noteId}/folder", put(file_note))
}

/// `folder.changed` published to the folder's owner.
fn published(app: &App, caller: &Caller, folder: &str) {
  let data = FolderEvent {
    owner: caller.owner.clone(),
    folder_id: folder.to_owned(),
  };
  app.events.publish("folder.changed", data, vec![caller.owner.clone()]);
}

/// A folder id a call names: given ids are held to the id rules.
fn named_id(id: &str) -> Answer<String> {
  if valid_id(id) {
    Ok(id.to_owned())
  } else {
    Err(ApiError::bad_request("A folder id is 1 to 64 letters, digits, - and _."))
  }
}

/// A folder write answered: the folder as it stands, or why it did not land.
fn folder_answer(id: &str, parent: Option<&str>, filed: Filed<Folder>) -> Answer<(Folder, bool)> {
  match filed {
    Filed::Done(folder, made) => Ok((folder, made)),
    Filed::Missing => Err(ApiError::not_found(format!("No folder {id} stands."))),
    Filed::NoFolder => Err(ApiError::no_folder(parent.unwrap_or(""))),
    Filed::Cycle => Err(ApiError::folder_cycle(id)),
    Filed::TooDeep => Err(ApiError::too_deep()),
  }
}

async fn list_folders(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Json<Page<Folder>>> {
  let caller = caller(&app, &headers, query(given)?.owner)?;
  let items = app.store.folders(&caller.owner).map_err(ApiError::failed)?;
  Ok(Json(Page { items, more: false }))
}

async fn make_folder(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let caller = caller(&app, &headers, query(given_query)?.owner)?;
  let given: NewFolder = body(&bytes)?;
  let id = match given.id.as_deref() {
    Some(id) => named_id(id)?,
    None => fresh_id(),
  };
  let name = clean_folder_name(&given.name)?;
  let parent = given.parent.as_deref().map(str::trim).filter(|parent| !parent.is_empty());
  let filed = app
    .store
    .make_folder(&caller.owner, &id, &name, parent, now_ms())
    .map_err(ApiError::failed)?;
  let (folder, made) = folder_answer(&id, parent, filed)?;
  if made {
    published(&app, &caller, &id);
  }
  Ok(json_answer(if made { StatusCode::CREATED } else { StatusCode::OK }, folder))
}

async fn change_folder(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let caller = caller(&app, &headers, query(given_query)?.owner)?;
  let given: FolderChange = body(&bytes)?;
  let name = given.name.as_deref().map(clean_folder_name).transpose()?;
  let parent = given.parent.as_ref().map(|parent| parent.as_deref().map(str::trim));
  if let Some(Some("")) = parent {
    return Err(ApiError::bad_request("parent names a folder, or is null for the top."));
  }
  let filed = app
    .store
    .change_folder(&caller.owner, &id, name.as_deref(), parent)
    .map_err(ApiError::failed)?;
  let (folder, _) = folder_answer(&id, parent.flatten(), filed)?;
  published(&app, &caller, &id);
  Ok(json_answer(StatusCode::OK, folder))
}

async fn delete_folder(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let caller = caller(&app, &headers, query(given)?.owner)?;
  if app.store.delete_folder(&caller.owner, &id).map_err(ApiError::failed)? {
    published(&app, &caller, &id);
  }
  Ok(StatusCode::NO_CONTENT.into_response())
}

async fn file_note(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let reach = reach(&app, &headers, query(given_query)?.owner, &id)?;
  reach.owns()?;
  let given: NoteFiling = body(&bytes)?;
  let folder = given.folder.as_deref().map(str::trim);
  if folder == Some("") {
    return Err(ApiError::bad_request("folder names a folder, or is null for none."));
  }
  match app.store.file_note(&reach.owner, &id, folder).map_err(ApiError::failed)? {
    Filed::Done(meta, _) => {
      let data = FiledEvent {
        note_id: id.clone(),
        owner: reach.owner.clone(),
        folder: meta.folder.clone(),
      };
      app.events.publish("note.filed", data, vec![reach.owner.clone()]);
      Ok(json_answer(StatusCode::OK, reach.held(meta)))
    }
    Filed::Missing => Err(ApiError::not_found(format!("No note {id} stands."))),
    Filed::NoFolder => Err(ApiError::no_folder(folder.unwrap_or(""))),
    Filed::Cycle | Filed::TooDeep => Err(ApiError::failed("A note's move answered as a folder's.")),
  }
}
