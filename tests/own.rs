//! What a reader keeps for themselves (`docs/api.md`, 「Pins」, 「What was opened」): pins and the record of
//! what they opened, each the calling account's own, answered only for the notes it reads live.

use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, held_port, note_body, sample_doc, settings};

const OWNER: &str = "1";
const MEMBER: &str = "2";
const STRANGER: &str = "3";

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  (scratch, ran)
}

async fn made(ran: &Ran, owner: &str, id: &str, title: &str) {
  let (status, _) = answered(ran.as_reader("POST", "/notes", owner, "member").json(&note_body(
    id,
    title,
    &sample_doc(1),
  )))
  .await;
  assert_eq!(status, StatusCode::CREATED);
}

async fn status_of(request: reqwest::RequestBuilder) -> StatusCode {
  request.send().await.expect("the service answered").status()
}

fn ids(page: &Value) -> Vec<String> {
  page["items"]
    .as_array()
    .expect("a page of rows")
    .iter()
    .map(|row| format!("{}/{}", row["owner"].as_str().unwrap_or(""), row["id"].as_str().unwrap_or("")))
    .collect()
}

async fn shared_with_member(ran: &Ran, id: &str) {
  let (status, _) = answered(
    ran
      .as_reader("POST", &format!("/notes/{id}/members"), OWNER, "member")
      .json(&json!({ "users": [MEMBER], "permission": "read" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn pins_are_each_accounts_own_in_pin_order() {
  let (_scratch, ran) = running("pins").await;
  made(&ran, OWNER, "a", "First").await;
  made(&ran, OWNER, "b", "Second").await;
  shared_with_member(&ran, "b").await;

  assert_eq!(
    status_of(ran.as_reader("PUT", "/notes/b/pin", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(
    status_of(ran.as_reader("PUT", "/notes/a/pin", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  // A pin made again keeps its place.
  assert_eq!(
    status_of(ran.as_reader("PUT", "/notes/b/pin", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  let (_, owner) = answered(ran.as_reader("GET", "/notes/pinned", OWNER, "member")).await;
  assert_eq!(ids(&owner), vec!["1/b", "1/a"]);
  assert_eq!(owner["more"], false);

  // The member pins the note shared with them; the owner's pins are not theirs to see.
  let (_, member) = answered(ran.as_reader("GET", "/notes/pinned", MEMBER, "member")).await;
  assert!(ids(&member).is_empty());
  assert_eq!(
    status_of(ran.as_reader("PUT", &format!("/notes/b/pin?owner={OWNER}"), MEMBER, "member")).await,
    StatusCode::NO_CONTENT
  );
  let (_, member) = answered(ran.as_reader("GET", "/notes/pinned", MEMBER, "member")).await;
  assert_eq!(ids(&member), vec!["1/b"]);
  assert_eq!(member["items"][0]["access"], "read");

  // A note not shared with the caller cannot be pinned, and stands as no note at all.
  assert_eq!(
    status_of(ran.as_reader("PUT", &format!("/notes/a/pin?owner={OWNER}"), STRANGER, "member")).await,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    status_of(ran.as_reader("PUT", "/notes/a/pin", STRANGER, "member")).await,
    StatusCode::NOT_FOUND
  );

  // Unpinning is the caller's own.
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/b/pin", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  let (_, owner) = answered(ran.as_reader("GET", "/notes/pinned", OWNER, "member")).await;
  assert_eq!(ids(&owner), vec!["1/a"]);
  let (_, member) = answered(ran.as_reader("GET", "/notes/pinned", MEMBER, "member")).await;
  assert_eq!(ids(&member), vec!["1/b"]);
}

#[tokio::test]
async fn a_pinned_note_drops_out_when_its_reader_no_longer_reads_it() {
  let (_scratch, ran) = running("pins-revoked").await;
  made(&ran, OWNER, "b", "Shared").await;
  shared_with_member(&ran, "b").await;
  assert_eq!(
    status_of(ran.as_reader("PUT", &format!("/notes/b/pin?owner={OWNER}"), MEMBER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(
    status_of(ran.as_reader("PUT", "/notes/b/pin", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );

  assert_eq!(
    status_of(ran.as_reader("DELETE", &format!("/notes/b/members/{MEMBER}"), OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  let (_, member) = answered(ran.as_reader("GET", "/notes/pinned", MEMBER, "member")).await;
  assert!(ids(&member).is_empty());
  // The pin it left is still the member's to take off.
  assert_eq!(
    status_of(ran.as_reader("DELETE", &format!("/notes/b/pin?owner={OWNER}"), MEMBER, "member")).await,
    StatusCode::NO_CONTENT
  );

  // Trashed, it leaves the owner's pins too, and a pin is refused; restored, it comes back.
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/b", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  let (_, owner) = answered(ran.as_reader("GET", "/notes/pinned", OWNER, "member")).await;
  assert!(ids(&owner).is_empty());
  let (status, refused) = answered(ran.as_reader("PUT", "/notes/b/pin", OWNER, "member")).await;
  assert_eq!((status, refused["code"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("trashed")));
  let (status, _) = answered(
    ran
      .as_reader("PATCH", "/notes/b", OWNER, "member")
      .json(&json!({ "version": 1, "restore": true })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let (_, owner) = answered(ran.as_reader("GET", "/notes/pinned", OWNER, "member")).await;
  assert_eq!(ids(&owner), vec!["1/b"]);
}

#[tokio::test]
async fn what_was_opened_is_the_readers_own_newest_first() {
  let (_scratch, ran) = running("recent").await;
  made(&ran, OWNER, "a", "First").await;
  made(&ran, OWNER, "b", "Second").await;
  shared_with_member(&ran, "b").await;

  // A read records nothing unless it says it opened the note.
  assert_eq!(status_of(ran.as_reader("GET", "/notes/a", OWNER, "member")).await, StatusCode::OK);
  let (_, none) = answered(ran.as_reader("GET", "/notes/recent", OWNER, "member")).await;
  assert!(ids(&none).is_empty());

  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/a?opened=true", OWNER, "member")).await,
    StatusCode::OK
  );
  tokio::time::sleep(std::time::Duration::from_millis(5)).await;
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/b?opened=true", OWNER, "member")).await,
    StatusCode::OK
  );
  let (_, owner) = answered(ran.as_reader("GET", "/notes/recent", OWNER, "member")).await;
  assert_eq!(ids(&owner), vec!["1/b", "1/a"]);
  assert!(owner["items"][0]["openedAt"].as_i64().is_some());

  // The member's record is their own; the owner's opening of the note is not in it.
  let (_, member) = answered(ran.as_reader("GET", "/notes/recent", MEMBER, "member")).await;
  assert!(ids(&member).is_empty());
  assert_eq!(
    status_of(ran.as_reader("GET", &format!("/notes/b?owner={OWNER}&opened=true"), MEMBER, "member")).await,
    StatusCode::OK
  );
  let (_, member) = answered(ran.as_reader("GET", "/notes/recent", MEMBER, "member")).await;
  assert_eq!(ids(&member), vec!["1/b"]);

  // A share taken back drops out of the member's record at once.
  assert_eq!(
    status_of(ran.as_reader("DELETE", &format!("/notes/b/members/{MEMBER}"), OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  let (_, member) = answered(ran.as_reader("GET", "/notes/recent", MEMBER, "member")).await;
  assert!(ids(&member).is_empty());

  let (status, _) = answered(ran.as_reader("GET", "/notes/recent?limit=51", OWNER, "member")).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  let (_, one) = answered(ran.as_reader("GET", "/notes/recent?limit=1", OWNER, "member")).await;
  assert_eq!(ids(&one), vec!["1/b"]);
}
