//! The platform administrator's deletion of an account or an organisation unit for good: what the note keeps of
//! it, counted and taken (docs/api.md, 「Removing an account」).

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{delete, get};
use axum::{Json, Router};
use bmo_console_face::OWNER_ROLE_HEADER;
use serde_json::{Value, json};

use crate::api::{Answer, audience, credential, publish_note};
use crate::app::App;
use crate::error::ApiError;

/// The role a console call names to reach a removal.
const ADMINISTRATOR: &str = "administrator";

/// The removal routes, outside the screens' guard.
pub fn routes() -> Router<Arc<App>> {
  Router::new()
    .route("/accounts/{account}/removal", get(account_removal))
    .route("/accounts/{account}", delete(remove_account))
    .route("/org-units/{unit}/removal", get(unit_removal))
    .route("/org-units/{unit}", delete(remove_unit))
}

// The service token, or the console credential naming the administrator's role; anyone else is refused.
fn administrator(app: &App, headers: &HeaderMap) -> Answer<()> {
  if credential(app, headers)? {
    return Ok(());
  }
  let role = headers.get(OWNER_ROLE_HEADER).and_then(|value| value.to_str().ok()).map(str::trim);
  if role == Some(ADMINISTRATOR) {
    Ok(())
  } else {
    Err(ApiError::forbidden("A removal is the platform administrator's alone."))
  }
}

// An account's or a unit's key: positive decimal digits.
fn key(given: &str) -> Answer<&str> {
  let digits = !given.is_empty() && given.len() <= 20 && given.bytes().all(|byte| byte.is_ascii_digit());
  if digits && given.bytes().any(|byte| byte != b'0') {
    Ok(given)
  } else {
    Err(ApiError::bad_request(format!("{given:?} is no account's or unit's key.")))
  }
}

async fn account_removal(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(account): Path<String>,
) -> Answer<Json<Value>> {
  administrator(&app, &headers)?;
  let (held, _) = app.store.account_held(key(&account)?).map_err(ApiError::failed)?;
  Ok(Json(json!({ "counts": held })))
}

async fn remove_account(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(account): Path<String>,
) -> Answer<Json<Value>> {
  administrator(&app, &headers)?;
  let account = key(&account)?;
  // Whoever each note was shared with hears of its going, read before the removal takes the shares.
  let (_, notes) = app.store.account_held(account).map_err(ApiError::failed)?;
  let audiences: Vec<(String, Vec<String>)> =
    notes.into_iter().map(|note| (note.clone(), audience(&app, account, &note))).collect();
  let removed = app.store.remove_account(account).map_err(ApiError::failed)?;
  for (note, audience) in audiences {
    publish_note(&app, "note.purged", account, &note, audience);
  }
  Ok(Json(json!({ "removed": removed })))
}

async fn unit_removal(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(unit): Path<String>,
) -> Answer<Json<Value>> {
  administrator(&app, &headers)?;
  key(&unit)?;
  Ok(Json(json!({ "counts": {} })))
}

async fn remove_unit(
  State(app): State<Arc<App>>,
  headers: HeaderMap,
  Path(unit): Path<String>,
) -> Answer<Json<Value>> {
  administrator(&app, &headers)?;
  key(&unit)?;
  Ok(Json(json!({ "removed": {} })))
}
