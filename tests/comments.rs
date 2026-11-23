//! A note's comment threads (`docs/api.md`, 「Comments」): started, replied to, resolved and reopened by
//! whoever writes the note, read by whoever reads it, deleted by their author or the owner, anchored by the
//! comment marks the stored document carries, and taken by a purge.

use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, held_port, settings};

const OWNER: &str = "1";
const EDITOR: &str = "2";
const READER: &str = "3";
const STRANGER: &str = "4";

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  (scratch, ran)
}

/// A document of the owner's whose words `marked` wears thread `thread`'s comment mark, where one is named.
fn doc_with(thread: Option<&str>) -> Value {
  let marked = match thread {
    Some(thread) => {
      json!({ "type": "text", "text": "marked", "marks": [{ "type": "comment", "attrs": { "thread": thread } }] })
    }
    None => json!({ "type": "text", "text": "marked" }),
  };
  json!({ "type": "doc", "content": [
    { "type": "title", "content": [{ "type": "text", "text": "Plans" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "some " }, marked] }
  ] })
}

/// The note `n1` of the owner, shared with an editor and a reader.
async fn ground(name: &str) -> (Scratch, Ran) {
  let (scratch, ran) = running(name).await;
  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes", OWNER, "member")
      .json(&json!({ "id": "n1", "doc": doc_with(None) })),
  )
  .await;
  assert_eq!(status, StatusCode::CREATED);
  for (user, permission) in [(EDITOR, "edit"), (READER, "read")] {
    let (status, _) = answered(
      ran
        .as_reader("POST", "/notes/n1/members", OWNER, "member")
        .json(&json!({ "users": [user], "permission": permission })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
  }
  (scratch, ran)
}

fn path(tail: &str, as_member: bool) -> String {
  let owner = if as_member { format!("?owner={OWNER}") } else { String::new() };
  format!("/notes/n1/threads{tail}{owner}")
}

#[tokio::test]
async fn a_thread_is_started_answered_resolved_and_reopened() {
  let (_scratch, ran) = ground("thread").await;
  let (status, thread) = answered(
    ran
      .as_reader("POST", &path("", false), OWNER, "member")
      .json(&json!({ "id": "t1", "quote": "marked", "body": "  Is this right?  " })),
  )
  .await;
  assert_eq!(status, StatusCode::CREATED, "{thread}");
  assert_eq!(
    (
      thread["author"].clone(),
      thread["quote"].clone(),
      thread["anchored"].clone(),
      thread["comments"][0]["body"].clone()
    ),
    (json!(OWNER), json!("marked"), json!(false), json!("Is this right?"))
  );

  // The mark the owner lays on the words anchors it.
  let (status, _) = answered(
    ran
      .as_reader("PATCH", "/notes/n1", OWNER, "member")
      .json(&json!({ "version": 1, "doc": doc_with(Some("t1")) })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);

  // The editor replies and resolves; a second start of the same id answers the thread as it stands.
  let (status, reply) = answered(
    ran
      .as_reader("POST", &path("/t1/comments", true), EDITOR, "member")
      .json(&json!({ "body": "Yes." })),
  )
  .await;
  assert_eq!((status, reply["author"].clone()), (StatusCode::CREATED, json!(EDITOR)));
  let (status, again) = answered(
    ran
      .as_reader("POST", &path("", true), EDITOR, "member")
      .json(&json!({ "id": "t1", "quote": "other", "body": "dup" })),
  )
  .await;
  assert_eq!((status, again["comments"].as_array().map(Vec::len)), (StatusCode::OK, Some(2)));
  let (status, resolved) = answered(
    ran
      .as_reader("PATCH", &path("/t1", true), EDITOR, "member")
      .json(&json!({ "resolved": true })),
  )
  .await;
  assert_eq!(
    (status, resolved["resolvedBy"].clone(), resolved["anchored"].clone()),
    (StatusCode::OK, json!(EDITOR), json!(true))
  );
  assert!(resolved["resolvedAt"].as_i64().is_some());

  // The reader reads it all; reopening clears the resolution.
  let (_, read) = answered(ran.as_reader("GET", &path("", true), READER, "member")).await;
  assert_eq!(read["items"][0]["comments"].as_array().map(Vec::len), Some(2));
  let (_, reopened) = answered(
    ran
      .as_reader("PATCH", &path("/t1", false), OWNER, "member")
      .json(&json!({ "resolved": false })),
  )
  .await;
  assert!(reopened["resolvedAt"].is_null() && reopened["resolvedBy"].is_null());

  // Each write was heard by the members.
  let (_, events) = answered(
    ran
      .as_reader("GET", "/events?kinds=note.commented", READER, "member")
      .header("accept", "application/json"),
  )
  .await;
  let heard = events["items"].as_array().expect("a page").len();
  assert_eq!(heard, 4, "started, replied, resolved, reopened");
  assert_eq!(events["items"][0]["data"]["thread"], "t1");
}

#[tokio::test]
async fn who_may_write_and_delete_comments() {
  let (_scratch, ran) = ground("rights").await;
  let start = |who: &str, id: &str| {
    ran
      .as_reader("POST", &path("", who != OWNER), who, "member")
      .json(&json!({ "id": id, "quote": "marked", "body": "words" }))
  };
  assert_eq!(answered(start(READER, "r1")).await.0, StatusCode::FORBIDDEN);
  assert_eq!(answered(start(STRANGER, "s1")).await.0, StatusCode::NOT_FOUND);
  assert_eq!(
    answered(ran.as_reader("GET", &path("", true), STRANGER, "member")).await.0,
    StatusCode::NOT_FOUND
  );
  let (_, by_editor) = answered(start(EDITOR, "e1")).await;
  answered(start(OWNER, "o1")).await;

  // What the route refuses of the words and the id.
  for wrong in [
    json!({ "id": "x y", "body": "a" }),
    json!({ "id": "ok", "body": "   " }),
    json!({ "id": "ok", "body": "a", "quote": "q".repeat(1001) }),
  ] {
    let (status, _) = answered(ran.as_reader("POST", &path("", false), OWNER, "member").json(&wrong)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{wrong}");
  }

  // The owner's comment is not the editor's to delete, nor the owner's thread; the editor's own are.
  let (_, threads) = answered(ran.as_reader("GET", &path("", false), OWNER, "member")).await;
  let owners = threads["items"]
    .as_array()
    .expect("a page")
    .iter()
    .find(|thread| thread["id"] == "o1")
    .expect("o1")
    .clone();
  let owners_comment = owners["comments"][0]["id"].as_str().expect("an id").to_owned();
  let refused =
    ran.as_reader("DELETE", &path(&format!("/o1/comments/{owners_comment}"), true), EDITOR, "member");
  assert_eq!(answered(refused).await.0, StatusCode::FORBIDDEN);
  assert_eq!(
    answered(ran.as_reader("DELETE", &path("/o1", true), EDITOR, "member")).await.0,
    StatusCode::FORBIDDEN
  );
  let editors_comment = by_editor["comments"][0]["id"].as_str().expect("an id").to_owned();
  let own =
    ran.as_reader("DELETE", &path(&format!("/e1/comments/{editors_comment}"), true), EDITOR, "member");
  assert_eq!(answered(own).await.0, StatusCode::NO_CONTENT);

  // The thread went with its last comment; the owner deletes any thread whole.
  assert_eq!(
    answered(ran.as_reader("DELETE", &path("/o1", false), OWNER, "member")).await.0,
    StatusCode::NO_CONTENT
  );
  let (_, threads) = answered(ran.as_reader("GET", &path("", false), OWNER, "member")).await;
  assert_eq!(threads["items"], json!([]));
  let (status, _) = answered(
    ran
      .as_reader("POST", &path("/gone/comments", false), OWNER, "member")
      .json(&json!({ "body": "x" })),
  )
  .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_trashed_note_keeps_its_threads_to_read_and_a_purge_takes_them() {
  let (_scratch, ran) = ground("trash").await;
  answered(
    ran
      .as_reader("POST", &path("", false), OWNER, "member")
      .json(&json!({ "id": "t1", "quote": "marked", "body": "kept" })),
  )
  .await;
  assert_eq!(
    answered(ran.as_reader("DELETE", "/notes/n1", OWNER, "member")).await.0,
    StatusCode::NO_CONTENT
  );
  let (status, read) = answered(ran.as_reader("GET", &path("", false), OWNER, "member")).await;
  assert_eq!((status, read["items"].as_array().map(Vec::len)), (StatusCode::OK, Some(1)));
  assert_eq!(
    answered(ran.as_reader("GET", &path("", true), EDITOR, "member")).await.0,
    StatusCode::NOT_FOUND
  );
  let (status, refusal) = answered(
    ran
      .as_reader("POST", &path("/t1/comments", false), OWNER, "member")
      .json(&json!({ "body": "x" })),
  )
  .await;
  assert_eq!((status, refusal["code"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("trashed")));

  assert_eq!(
    answered(ran.as_reader("DELETE", "/notes/n1?purge=true", OWNER, "member")).await.0,
    StatusCode::NO_CONTENT
  );
  // A note made again at the id starts with no threads.
  answered(
    ran
      .as_reader("POST", "/notes", OWNER, "member")
      .json(&json!({ "id": "n1", "doc": doc_with(None) })),
  )
  .await;
  let (_, read) = answered(ran.as_reader("GET", &path("", false), OWNER, "member")).await;
  assert_eq!(read["items"], json!([]));
}

#[tokio::test]
async fn a_share_link_opens_the_words_without_their_comment_marks() {
  let (_scratch, ran) = ground("share").await;
  answered(
    ran
      .as_reader("PATCH", "/notes/n1", OWNER, "member")
      .json(&json!({ "version": 1, "doc": doc_with(Some("t1")) })),
  )
  .await;
  let (_, link) = answered(ran.as_reader("POST", "/notes/n1/link", OWNER, "member").json(&json!({}))).await;
  let token = link["token"].as_str().expect("a token");
  let (_, shared) = answered(ran.as_console("GET", &format!("/shares/{token}"))).await;
  assert_eq!(shared["doc"], doc_with(None));
  let (_, own) = answered(ran.as_reader("GET", "/notes/n1", OWNER, "member")).await;
  assert_eq!(own["doc"], doc_with(Some("t1")), "the note's own read keeps them");
}
