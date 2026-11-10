//! The stream the writes publish: each account sees its own notes' events alone, a resume past the
//! kept window is gone, and a live stream carries what comes after it opens (`docs/api.md`, 「Events the
//! note service publishes」).

use axum::http::StatusCode;
use futures_util::StreamExt;
use serde_json::json;

use crate::support::{Ran, Scratch, answered, base64, doc_bytes, held_port, note_body, settings};

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let own = settings(&scratch, listen);
  (scratch, Ran::start(own, listener).await)
}

/// Every event a reader's page answers, newest held last.
async fn page(ran: &Ran, key: &str, query: &str) -> Vec<serde_json::Value> {
  let (_, answer) = answered(
    ran
      .as_reader("GET", &format!("/events?{query}"), key, "member")
      .header("accept", "application/json"),
  )
  .await;
  answer["items"].as_array().expect("a page of events").clone()
}

#[tokio::test]
async fn every_write_publishes_one_event_to_its_owner() {
  let (_scratch, ran) = running("events").await;
  let doc = doc_bytes(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Seen", &doc))).await;
  let held = doc_bytes(2);
  answered(
    ran
      .as_reader("PATCH", "/notes/a1", "1", "member")
      .json(&json!({ "version": 1, "doc": base64(&held) })),
  )
  .await;
  answered(ran.as_reader("DELETE", "/notes/a1", "1", "member")).await;
  answered(
    ran
      .as_reader("PATCH", "/notes/a1", "1", "member")
      .json(&json!({ "version": 2, "restore": true })),
  )
  .await;
  answered(ran.as_reader("DELETE", "/notes/a1", "1", "member")).await;
  answered(ran.as_reader("DELETE", "/notes/a1?purge=true", "1", "member")).await;

  let events = page(&ran, "1", "limit=100").await;
  let kinds: Vec<&str> = events.iter().map(|event| event["kind"].as_str().expect("a kind")).collect();
  assert_eq!(
    kinds,
    [
      "note.saved",
      "note.saved",
      "note.trashed",
      "note.restored",
      "note.trashed",
      "note.purged"
    ],
    "each write publishes its event, in the order they happened"
  );
  assert_eq!(events[0]["data"]["noteId"], "a1");
  assert_eq!(events[0]["data"]["owner"], "1");
}

#[tokio::test]
async fn a_reader_is_given_its_own_notes_events_alone() {
  let (_scratch, ran) = running("own-stream").await;
  let doc = doc_bytes(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "One", &doc))).await;
  answered(ran.as_reader("POST", "/notes", "9", "member").json(&note_body("b1", "Nine", &doc))).await;

  let own: Vec<String> = page(&ran, "9", "limit=100")
    .await
    .iter()
    .map(|event| event["data"]["noteId"].as_str().expect("an id").to_owned())
    .collect();
  assert_eq!(own, ["b1"]);

  let every: Vec<String> = page(&ran, "1", "limit=100")
    .await
    .iter()
    .map(|event| event["data"]["noteId"].as_str().expect("an id").to_owned())
    .collect();
  assert_eq!(every, ["a1"]);

  // The service token reads every one.
  let (_, answer) =
    answered(ran.call("GET", "/events?limit=100").header("accept", "application/json")).await;
  assert_eq!(answer["items"].as_array().expect("a page").len(), 2);
}

#[tokio::test]
async fn a_resume_from_before_the_window_is_gone() {
  let (_scratch, ran) = running("gone").await;
  let (status, refusal) = answered(
    ran
      .as_reader("GET", "/events?after=1", "1", "member")
      .header("accept", "application/json"),
  )
  .await;
  assert_eq!(status, StatusCode::GONE);
  assert_eq!(refusal["code"], "gone");
}

#[tokio::test]
async fn a_live_stream_carries_what_comes_after_it_opens() {
  let (_scratch, ran) = running("live").await;
  let response = ran.as_reader("GET", "/events", "1", "member").send().await.expect("the stream opens");
  assert_eq!(response.status(), StatusCode::OK);
  assert!(
    response.headers()["content-type"]
      .to_str()
      .expect("a type")
      .starts_with("text/event-stream"),
    "the answer is a stream"
  );

  let doc = doc_bytes(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("late", "Late", &doc))).await;

  let mut bytes = response.bytes_stream();
  let mut seen = String::new();
  while !seen.contains("event: note.saved") || !seen.contains("\"noteId\":\"late\"") {
    let chunk = bytes.next().await.expect("the stream carries the event").expect("the chunk arrives");
    seen.push_str(&String::from_utf8_lossy(&chunk));
  }
  assert!(seen.contains("id:"), "the event carries its number");
}
