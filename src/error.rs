//! A refusal or a failure, answered in the platform's error shape (`docs/api.md`, 「Codes」).

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

use crate::wire::WireError;

/// Every code the service answers, each with its status and what it means.
pub const CODES: [(&str, u16, &str); 13] = [
  ("bad-request", 400, "the body or the query is not the shape the route takes"),
  ("unauthorized", 401, "the token is missing or wrong"),
  ("forbidden", 403, "the token is right but the caller may not do this"),
  ("no-route", 404, "no route answers this method and path"),
  ("not-found", 404, "nothing stands at the key the path names"),
  ("gone", 410, "a resume from before the events the service keeps"),
  ("too-large", 413, "a document past the stored byte cap"),
  ("version-conflict", 409, "a save made from behind the stored version"),
  ("no-owner", 422, "a service-token call naming no account"),
  ("bad-doc", 422, "a doc that is not base64 bytes"),
  ("trashed", 422, "a write on a note standing in the trash"),
  ("not-trashed", 422, "a purge of a note that does not stand in the trash"),
  ("failed", 500, "the service failed"),
];

/// A refusal or a failure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiError {
  pub status: u16,
  pub code: &'static str,
  pub error: String,
}

impl ApiError {
  fn of(code: &'static str, error: impl Into<String>) -> Self {
    let status = CODES
      .iter()
      .find(|(name, ..)| *name == code)
      .map(|(_, status, _)| *status)
      .unwrap_or(500);

    Self {
      status,
      code,
      error: error.into(),
    }
  }

  pub fn bad_request(error: impl Into<String>) -> Self {
    Self::of("bad-request", error)
  }

  pub fn unauthorized() -> Self {
    Self::of("unauthorized", "The bearer token is missing or wrong.")
  }

  pub fn forbidden(error: impl Into<String>) -> Self {
    Self::of("forbidden", error)
  }

  pub fn no_route() -> Self {
    Self::of("no-route", "No route answers this method and path.")
  }

  pub fn not_found(error: impl Into<String>) -> Self {
    Self::of("not-found", error)
  }

  pub fn gone(error: impl Into<String>) -> Self {
    Self::of("gone", error)
  }

  pub fn too_large(max: usize) -> Self {
    Self::of("too-large", format!("The body is over the {max} bytes the store keeps."))
  }

  pub fn version_conflict(error: impl Into<String>) -> Self {
    Self::of("version-conflict", error)
  }

  pub fn no_owner() -> Self {
    Self::of("no-owner", "The call names no account to answer for.")
  }

  pub fn bad_doc(error: impl Into<String>) -> Self {
    Self::of("bad-doc", error)
  }

  pub fn trashed(id: &str) -> Self {
    Self::of("trashed", format!("The note {id} stands in the trash."))
  }

  pub fn not_trashed(id: &str) -> Self {
    Self::of("not-trashed", format!("The note {id} does not stand in the trash."))
  }

  pub fn failed(error: impl Into<String>) -> Self {
    Self::of("failed", error)
  }
}

impl IntoResponse for ApiError {
  fn into_response(self) -> Response {
    let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let body = WireError {
      code: self.code.to_owned(),
      error: self.error,
    };
    (status, axum::Json(body)).into_response()
  }
}
