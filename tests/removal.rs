//! The platform administrator's deletion of an account for good (`docs/api.md`, 「Removing an account」): the
//! count changes nothing and names what the removal then takes; the account's notes go whole, its share of
//! another's note goes while that note stays, another account's notes stay, a second removal takes nothing, and
//! a member's console call is refused.

use axum::http::StatusCode;
use serde_json::json;

use crate::support::{Ran, Scratch, answered, held_port, note_body, sample_doc, settings};

/// The account deleted, and another whose things stay.
const GOING: &str = "7";
const STAYING: &str = "8";

async fn write_note(ran: &Ran, owner: &str, id: &str) {
  let (status, body) = answered(ran.as_reader("POST", "/notes", owner, "member").json(&note_body(
    id,
    "Plans",
    &sample_doc(1),
  )))
  .await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn an_accounts_notes_and_its_shares_go_and_nothing_else_does() {
  let scratch = Scratch::make("removal");
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  write_note(&ran, GOING, "n1").await;
  write_note(&ran, GOING, "n2").await;
  write_note(&ran, STAYING, "n1").await;
  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes/n1/members", STAYING, "member")
      .json(&json!({ "users": [GOING], "permission": "read" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes/n1/members", GOING, "member")
      .json(&json!({ "users": [STAYING], "permission": "read" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);

  let path = format!("/accounts/{GOING}");
  let (status, counted) =
    answered(ran.as_reader("GET", &format!("{path}/removal"), "1", "administrator")).await;
  assert_eq!(status, StatusCode::OK, "{counted}");
  assert_eq!(
    counted["counts"],
    json!({ "notes": 2, "folders": 0, "member-shares": 1, "bookmarks": 0, "opened": 0 })
  );
  let (status, _) =
    answered(ran.as_reader("GET", &format!("/notes/n1?owner={GOING}"), STAYING, "member")).await;
  assert_eq!(status, StatusCode::OK, "a count changes nothing");

  let (status, removed) = answered(ran.as_reader("DELETE", &path, "1", "administrator")).await;
  assert_eq!(status, StatusCode::OK, "{removed}");
  assert_eq!(removed["removed"], counted["counts"]);
  let (status, _) = answered(ran.as_reader("GET", "/notes/n1", GOING, "member")).await;
  assert_eq!(status, StatusCode::NOT_FOUND, "the account's note is gone");
  let (status, members) = answered(ran.as_reader("GET", "/notes/n1/members", STAYING, "member")).await;
  assert_eq!(status, StatusCode::OK);
  assert!(
    !members.to_string().contains(&format!("\"{GOING}\"")),
    "its share of another's note is gone: {members}"
  );
  let (status, _) = answered(ran.as_reader("GET", "/notes/n1", STAYING, "member")).await;
  assert_eq!(status, StatusCode::OK, "another account's note stays");

  let (status, again) = answered(ran.call("DELETE", &path)).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(
    again["removed"],
    json!({ "notes": 0, "folders": 0, "member-shares": 0, "bookmarks": 0, "opened": 0 })
  );
}

#[tokio::test]
async fn a_removal_is_the_administrators_alone_and_names_a_key() {
  let scratch = Scratch::make("removal-refused");
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  let (status, _) = answered(ran.as_reader("DELETE", "/accounts/7", "7", "member")).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, _) = answered(ran.call("DELETE", "/accounts/seven")).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  let (status, unit) = answered(ran.call("DELETE", "/org-units/13?company=3")).await;
  assert_eq!((status, unit), (StatusCode::OK, json!({ "removed": {} })));
}
