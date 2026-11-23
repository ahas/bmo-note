//! What a reader keeps of the notes for themselves, and how they find one (`docs/api.md`, 「Bookmarks」, 「What
//! was opened」, 「Search」): each account's own bookmarks and record of what it opened, and the search over the
//! notes it reads. Every answer here is read for the calling account alone, and holds only what that
//! account reads at the moment of the read.

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{delete, get};

use crate::api::{Answer, Caller, body, caller, json_answer, query};
use crate::app::App;
use crate::doc::LINE_WORDS_MAX;
use crate::error::ApiError;
use crate::model::{now_ms, valid_id};
use crate::search::{QUERY_MAX, index_query, indexed, snippet, terms, title_hits};
use crate::store::{Search, Views};
use crate::wire::{
  AccountEvent, Bookmark, BookmarkKind, NewBookmark, NoteQuery, OpenedNote, Page, RecentQuery, SearchHit,
  SearchQuery,
};

/// How many notes a read of what was opened answers where it names no limit, and at most.
const RECENT_DEFAULT: i64 = 20;
const RECENT_MAX: i64 = 50;

/// How many rows a search answers where it names no limit, and at most.
const FOUND_DEFAULT: i64 = 20;
const FOUND_MAX: i64 = 50;

/// How far back a change counts as recent to a search's best match.
const RECENT_CHANGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// The routes of the reader's own bookmarks, what they opened, and the search.
pub fn routes() -> Router<Arc<App>> {
  Router::new()
    .route("/bookmarks", get(bookmarks).post(add_bookmark))
    .route("/bookmarks/{bookmarkId}", delete(delete_bookmark))
    .route("/notes/recent", get(recent))
    .route("/notes/search", get(search))
}

// ---------------------------------------------------------------------------------------------------------
// Bookmarks

async fn bookmarks(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Json<Page<Bookmark>>> {
  let caller = caller(&app, &headers, query(given)?.owner)?;
  let items = app.store.bookmarks(&caller.owner).map_err(ApiError::failed)?;
  Ok(Json(Page { items, more: false }))
}

/// `bookmark.changed` published to the account whose bookmarks they are.
fn published(app: &App, caller: &Caller) {
  let data = AccountEvent {
    owner: caller.owner.clone(),
  };
  app.events.publish("bookmark.changed", data, vec![caller.owner.clone()]);
}

/// A field a kind needs, given and not empty.
fn needed<'a>(field: &'a Option<String>, name: &str) -> Answer<&'a str> {
  field
    .as_deref()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .ok_or_else(|| ApiError::bad_request(format!("This bookmark names its {name}.")))
}

async fn add_bookmark(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given_query: Result<Query<NoteQuery>, QueryRejection>,
  bytes: Bytes,
) -> Answer<Response> {
  let caller = caller(&app, &headers, query(given_query)?.owner)?;
  let given: NewBookmark = body(&bytes)?;
  let account = caller.owner.clone();
  let (owner, note, folder, block, quote) = match given.kind {
    BookmarkKind::Folder => {
      let folder = needed(&given.folder_id, "folderId")?;
      if !app.store.has_folder(&account, folder).map_err(ApiError::failed)? {
        return Err(ApiError::not_found(format!("No folder {folder} stands.")));
      }
      (String::new(), String::new(), folder.to_owned(), String::new(), String::new())
    }
    BookmarkKind::Note | BookmarkKind::Line => {
      let note = needed(&given.note_id, "noteId")?;
      let owner = given
        .note_owner
        .as_deref()
        .map(str::trim)
        .filter(|owner| !owner.is_empty())
        .unwrap_or(&account)
        .to_owned();
      reads_live(&app, &account, &owner, note)?;
      let (block, quote) = if given.kind == BookmarkKind::Line {
        let block = needed(&given.block, "block")?;
        if !valid_id(block) {
          return Err(ApiError::bad_request("A block is 1 to 64 letters, digits, - and _."));
        }
        let quote = given.quote.as_deref().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ");
        if quote.chars().count() > LINE_WORDS_MAX {
          return Err(ApiError::bad_request(format!("A quote is at most {LINE_WORDS_MAX} characters.")));
        }
        (block.to_owned(), quote)
      } else {
        (String::new(), String::new())
      };
      (owner, note.to_owned(), String::new(), block, quote)
    }
  };
  let (id, made) = app
    .store
    .add_bookmark(&account, given.kind, &owner, &note, &folder, &block, &quote, now_ms())
    .map_err(ApiError::failed)?;
  if made {
    published(&app, &caller);
  }
  let bookmark = app
    .store
    .bookmarks(&account)
    .map_err(ApiError::failed)?
    .into_iter()
    .find(|bookmark| bookmark.id == id)
    .ok_or_else(|| ApiError::failed("The bookmark made does not read back."))?;
  Ok(json_answer(if made { StatusCode::CREATED } else { StatusCode::OK }, bookmark))
}

/// Refuses a note the account does not read live: its own in the trash is `trashed`, anything else stands
/// as no note at all.
fn reads_live(app: &App, account: &str, owner: &str, note: &str) -> Answer<()> {
  let live = app.store.meta(owner, note, Some(false)).map_err(ApiError::failed)?.is_some();
  let reads =
    owner == account || app.store.permission(owner, note, account).map_err(ApiError::failed)?.is_some();
  if live && reads {
    return Ok(());
  }
  if owner == account && app.store.meta(owner, note, Some(true)).map_err(ApiError::failed)?.is_some() {
    return Err(ApiError::trashed(note));
  }
  Err(ApiError::not_found(format!("No note {note} stands.")))
}

/// A bookmark is the caller's own row, so taking it off reads nothing it names.
async fn delete_bookmark(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let caller = caller(&app, &headers, query(given)?.owner)?;
  app.store.delete_bookmark(&caller.owner, &id).map_err(ApiError::failed)?;
  published(&app, &caller);
  Ok(StatusCode::NO_CONTENT.into_response())
}

// ---------------------------------------------------------------------------------------------------------
// What was opened

async fn recent(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given: Result<Query<RecentQuery>, QueryRejection>,
) -> Answer<Json<Page<OpenedNote>>> {
  let given = query(given)?;
  let caller = caller(&app, &headers, given.owner)?;
  let limit = given.limit.unwrap_or(RECENT_DEFAULT);
  if !(1..=RECENT_MAX).contains(&limit) {
    return Err(ApiError::bad_request(format!("limit is 1 to {RECENT_MAX}")));
  }
  let items = app
    .store
    .recent(&caller.owner, limit)
    .map_err(ApiError::failed)?
    .into_iter()
    .map(|(meta, opened_at)| OpenedNote { meta, opened_at })
    .collect();
  Ok(Json(Page { items, more: false }))
}

// ---------------------------------------------------------------------------------------------------------
// Search

/// The views a search names, `mine,shared` where it names none.
fn views_of(within: Option<&str>) -> Answer<Views> {
  let Some(within) = within else {
    return Ok(Views {
      mine: true,
      shared: true,
      trash: false,
    });
  };
  let mut views = Views::default();
  for word in within.split(',').map(str::trim).filter(|word| !word.is_empty()) {
    match word {
      "mine" => views.mine = true,
      "shared" => views.shared = true,
      "trash" => views.trash = true,
      _ => return Err(ApiError::bad_request(format!("in names mine, shared and trash, not {word}."))),
    }
  }
  Ok(views)
}

async fn search(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given: Result<Query<SearchQuery>, QueryRejection>,
) -> Answer<Json<Page<SearchHit>>> {
  let given = query(given)?;
  let caller = caller(&app, &headers, given.owner.clone())?;
  let asked = given.q.as_deref().unwrap_or("").trim();
  if asked.chars().count() > QUERY_MAX {
    return Err(ApiError::bad_request(format!("q is at most {QUERY_MAX} characters.")));
  }
  let terms = terms(asked);
  if terms.is_empty() {
    return Err(ApiError::bad_request("q names nothing to search for."));
  }
  let limit = given.limit.unwrap_or(FOUND_DEFAULT);
  if !(1..=FOUND_MAX).contains(&limit) {
    return Err(ApiError::bad_request(format!("limit is 1 to {FOUND_MAX}")));
  }
  let offset = given.after.unwrap_or(0);
  if offset < 0 {
    return Err(ApiError::bad_request("after is how many rows were already read, from 0."));
  }
  let title_only = given.title_only.unwrap_or(false);
  let index_query = index_query(&terms, title_only);
  // A search of short terms alone reads titles alone, so its rows carry no stretch of text.
  let titles_alone = title_only || index_query.is_none();
  let asked = Search {
    account: caller.owner,
    views: views_of(given.within.as_deref())?,
    index_query,
    short_terms: terms.iter().filter(|term| !indexed(term)).cloned().collect(),
    title_only,
    since: given.since,
    order: given.sort.unwrap_or_default(),
    recent_since: now_ms() - RECENT_CHANGE_MS,
    offset,
    limit,
  };
  let (found, more) = app.store.search(&asked).map_err(ApiError::failed)?;
  let items = found
    .into_iter()
    .map(|found| SearchHit {
      title_hits: title_hits(&found.title, &terms),
      snippet: if titles_alone { None } else { snippet(&found.body, &terms) },
      meta: found.meta,
    })
    .collect();
  Ok(Json(Page { items, more }))
}
