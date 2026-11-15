//! What a reader keeps of the notes for themselves, and how they find one (`docs/api.md`, 「Pins」, 「What
//! was opened」, 「Search」): each account's own pins and record of what it opened, and the search over the
//! notes it reads. Every answer here is read for the calling account alone, and holds only what that
//! account reads at the moment of the read.

use std::sync::Arc;

use axum::Router;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, put};

use crate::api::{Answer, caller, query, reach};
use crate::app::App;
use crate::error::ApiError;
use crate::model::now_ms;
use crate::search::{QUERY_MAX, index_query, indexed, snippet, terms, title_hits};
use crate::store::{Search, Views};
use crate::wire::{NoteMeta, NoteQuery, NotesQuery, OpenedNote, Page, RecentQuery, SearchHit, SearchQuery};

/// How many notes a read of what was opened answers where it names no limit, and at most.
const RECENT_DEFAULT: i64 = 20;
const RECENT_MAX: i64 = 50;

/// How many rows a search answers where it names no limit, and at most.
const FOUND_DEFAULT: i64 = 20;
const FOUND_MAX: i64 = 50;

/// How far back a change counts as recent to a search's best match.
const RECENT_CHANGE_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// The routes of the reader's own pins, what they opened, and the search.
pub fn routes() -> Router<Arc<App>> {
  Router::new()
    .route("/notes/pinned", get(pinned))
    .route("/notes/recent", get(recent))
    .route("/notes/search", get(search))
    .route("/notes/{noteId}/pin", put(pin).delete(unpin))
}

// ---------------------------------------------------------------------------------------------------------
// Pins

async fn pinned(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  given: Result<Query<NotesQuery>, QueryRejection>,
) -> Answer<Json<Page<NoteMeta>>> {
  let caller = caller(&app, &headers, query(given)?.owner)?;
  let items = app.store.pinned(&caller.owner).map_err(ApiError::failed)?;
  Ok(Json(Page { items, more: false }))
}

async fn pin(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let reach = reach(&app, &headers, query(given)?.owner, &id)?;
  if app.store.meta(&reach.owner, &id, Some(false)).map_err(ApiError::failed)?.is_none() {
    return Err(match app.store.meta(&reach.owner, &id, Some(true)).map_err(ApiError::failed)? {
      Some(_) => ApiError::trashed(&id),
      None => ApiError::not_found(format!("No note {id} stands.")),
    });
  }
  app.store.pin(&reach.account, &reach.owner, &id, now_ms()).map_err(ApiError::failed)?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

/// A pin is the caller's own row, so taking it off reads no note: a share taken back still lets the reader
/// take off the pin it left.
async fn unpin(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(id): Path<String>,
  given: Result<Query<NoteQuery>, QueryRejection>,
) -> Answer<Response> {
  let named = query(given)?.owner;
  let caller = caller(&app, &headers, named.clone())?;
  let owner = match named.map(|named| named.trim().to_owned()).filter(|named| !named.is_empty()) {
    Some(named) if !caller.service => named,
    _ => caller.owner.clone(),
  };
  app.store.unpin(&caller.owner, &owner, &id).map_err(ApiError::failed)?;
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
