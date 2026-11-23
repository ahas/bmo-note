//! The notes as the routes keep them: made, read, saved and refused, each account's own, trashed,
//! restored and purged (`docs/api.md`, 「Notes」).

use std::collections::BTreeSet;

use axum::http::StatusCode;
use serde_json::json;

use crate::support::{
  Ran, Scratch, answered, body_of, doc_of, held_port, note_body, sample_doc, settings, size_of,
};

/// The service every notes test runs against, with the store it keeps.
async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  (scratch, ran)
}

#[tokio::test]
async fn a_note_is_made_and_reads_back_with_its_document() {
  let (_scratch, ran) = running("make").await;
  let doc = sample_doc(1);
  let (status, meta) =
    answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Groceries", &doc)))
      .await;
  assert_eq!(status, StatusCode::CREATED);
  assert_eq!(meta["id"], "a1");
  assert_eq!(meta["title"], "Groceries");
  assert_eq!(meta["version"], 1);
  assert_eq!(meta["size"], size_of(&note_body("a1", "Groceries", &doc)["doc"]));
  assert!(meta["deletedAt"].is_null());

  let (status, note) = answered(ran.as_reader("GET", "/notes/a1", "1", "member")).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body_of(&note["doc"]), body_of(&doc));
  assert_eq!(note["version"], 1);
}

#[tokio::test]
async fn a_second_make_of_an_id_held_answers_the_note_as_it_stands() {
  let (_scratch, ran) = running("idem").await;
  let first = sample_doc(1);
  let second = sample_doc(2);
  answered(
    ran
      .as_reader("POST", "/notes", "1", "member")
      .json(&note_body("a1", "Groceries", &first)),
  )
  .await;
  let (status, meta) =
    answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Else", &second))).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(meta["version"], 1);
  assert_eq!(meta["title"], "Groceries");
  let (_, note) = answered(ran.as_reader("GET", "/notes/a1", "1", "member")).await;
  assert_eq!(body_of(&note["doc"]), body_of(&first));
}

#[tokio::test]
async fn a_save_moves_the_version_up_and_one_from_behind_is_refused_what_stands() {
  let (_scratch, ran) = running("save").await;
  let doc = sample_doc(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Groceries", &doc))).await;

  let held = doc_of("Groceries and more", &["Words of the sample 3"]);
  let (status, meta) = answered(
    ran
      .as_reader("PATCH", "/notes/a1", "1", "member")
      .json(&json!({ "version": 1, "doc": &held })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(meta["version"], 2);
  assert_eq!(meta["title"], "Groceries and more", "the title is read from the document");
  assert_eq!(meta["size"], size_of(&held));

  let (status, conflict) = answered(
    ran
      .as_reader("PATCH", "/notes/a1", "1", "member")
      .json(&json!({ "version": 1, "doc": &doc })),
  )
  .await;
  assert_eq!(status, StatusCode::CONFLICT);
  assert_eq!(conflict["code"], "version-conflict");
  assert_eq!(conflict["note"]["version"], 2);
  let (_, note) = answered(ran.as_reader("GET", "/notes/a1", "1", "member")).await;
  assert_eq!(body_of(&note["doc"]), body_of(&held), "the refused save wrote nothing");
}

#[tokio::test]
async fn a_save_without_a_document_writes_nothing() {
  let (_scratch, ran) = running("title-only").await;
  let doc = sample_doc(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Groceries", &doc))).await;
  let (status, meta) = answered(
    ran
      .as_reader("PATCH", "/notes/a1", "1", "member")
      .json(&json!({ "version": 1, "title": "Market run" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!((meta["title"].clone(), meta["version"].clone()), (json!("Groceries"), json!(1)));
}

#[tokio::test]
async fn an_untitled_note_is_named_by_its_first_line_of_words() {
  let (_scratch, ran) = running("first-line").await;
  let (_, meta) = answered(
    ran
      .as_reader("POST", "/notes", "1", "member")
      .json(&json!({ "id": "a1", "doc": doc_of("", &["", "  Shopping\tlist  ", "milk"]) })),
  )
  .await;
  assert_eq!(meta["title"], "Shopping list");
}

#[tokio::test]
async fn a_title_is_trimmed_to_one_line() {
  let (_scratch, ran) = running("title").await;
  let doc = sample_doc(1);
  let (_, meta) = answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body(
    "a1",
    "  Hello\nWide  ",
    &doc,
  )))
  .await;
  assert_eq!(meta["title"], "Hello Wide");
}

#[tokio::test]
async fn notes_are_each_accounts_own() {
  let (_scratch, ran) = running("owners").await;
  let doc = sample_doc(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Mine", &doc))).await;

  let (status, _) = answered(ran.as_reader("GET", "/notes/a1", "2", "member")).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let (_, page) = answered(ran.as_reader("GET", "/notes", "2", "member")).await;
  assert_eq!(page["items"].as_array().expect("a page").len(), 0);

  let (_, mine) = answered(ran.as_reader("GET", "/notes", "1", "member")).await;
  assert_eq!(mine["items"].as_array().expect("a page").len(), 1);
}

#[tokio::test]
async fn the_list_pages_newest_changed_first() {
  let (_scratch, ran) = running("list").await;
  for (id, mark) in [("one", 1u8), ("two", 2), ("three", 3)] {
    answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body(
      id,
      "Title",
      &sample_doc(mark),
    )))
    .await;
  }
  // Move "one" to the front of the order by saving it last.
  let held = sample_doc(9);
  answered(
    ran
      .as_reader("PATCH", "/notes/one", "1", "member")
      .json(&json!({ "version": 1, "doc": &held })),
  )
  .await;

  let (_, page) = answered(ran.as_reader("GET", "/notes?limit=2", "1", "member")).await;
  let first: Vec<&str> = page["items"]
    .as_array()
    .expect("a page")
    .iter()
    .map(|item| item["id"].as_str().expect("an id"))
    .collect();
  assert_eq!(first[0], "one", "the saved note stands before the untouched ones");
  assert_eq!(page["more"], true);

  let last = page["items"].as_array().expect("a page").last().expect("a row");
  let cursor = format!(
    "{}:{}",
    last["changedAt"].as_i64().expect("a moment"),
    last["id"].as_str().expect("an id")
  );
  let (_, next) =
    answered(ran.as_reader("GET", &format!("/notes?limit=2&after={cursor}"), "1", "member")).await;
  let second: Vec<&str> = next["items"]
    .as_array()
    .expect("a page")
    .iter()
    .map(|item| item["id"].as_str().expect("an id"))
    .collect();
  // Which of the two created together stands first is the moment's to say; the pages together hold
  // every note once, in the order the service chose.
  let all: BTreeSet<&str> = first.into_iter().chain(second).collect();
  assert_eq!(all, BTreeSet::from(["one", "two", "three"]), "the pages together hold every note once");
  assert_eq!(next["more"], false);
}

#[tokio::test]
async fn a_service_token_call_answers_for_the_owner_it_names() {
  let (_scratch, ran) = running("service").await;
  let doc = sample_doc(1);
  let (status, _) =
    answered(ran.call("POST", "/notes?owner=3").json(&note_body("a1", "Owned", &doc))).await;
  assert_eq!(status, StatusCode::CREATED);
  let (_, page) = answered(ran.call("GET", "/notes?owner=3")).await;
  assert_eq!(page["items"].as_array().expect("a page").len(), 1);

  let (status, refusal) =
    answered(ran.call("POST", "/notes").json(&note_body("a2", "Ownerless", &doc))).await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert_eq!(refusal["code"], "no-owner");
}

#[tokio::test]
async fn calls_without_a_credential_or_a_reader_are_refused() {
  let (_scratch, ran) = running("guard").await;
  let client = reqwest::Client::builder().no_proxy().build().expect("a client");
  let (status, refusal) = answered(client.get(format!("{}{}", ran.address, "/notes"))).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert_eq!(refusal["code"], "unauthorized");

  let (status, refusal) = answered(ran.as_console("GET", "/notes")).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert_eq!(refusal["code"], "forbidden");

  let (status, _) = answered(ran.as_reader("GET", "/notes", "1", "guest")).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_document_outside_its_shape_is_refused() {
  let (_scratch, ran) = running("doc").await;
  // Bytes of the earlier editor, a page that is no document and a node with no type are each refused.
  for wrong in [
    json!("AQID"),
    json!({ "type": "page", "content": [] }),
    json!({ "type": "doc", "content": [{ "text": "untyped" }] }),
    json!({ "type": "doc" }),
  ] {
    let (status, refusal) = answered(
      ran
        .as_reader("POST", "/notes", "1", "member")
        .json(&json!({ "id": "a1", "doc": wrong })),
    )
    .await;
    assert_eq!((status, refusal["code"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("bad-doc")));
  }

  let (status, refusal) = answered(
    ran
      .as_reader("POST", "/notes", "1", "member")
      .json(&json!({ "id": "a b", "doc": &sample_doc(1) })),
  )
  .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  assert_eq!(refusal["code"], "bad-request");

  let over = doc_of("T", &[&"x".repeat(crate::support::TEST_DOC_MAX)]);
  let (status, refusal) =
    answered(ran.as_reader("POST", "/notes", "1", "member").json(&json!({ "doc": over }))).await;
  assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
  assert_eq!(refusal["code"], "too-large");
}

#[tokio::test]
async fn a_note_is_trashed_restored_and_purged() {
  let (_scratch, ran) = running("trash").await;
  let doc = sample_doc(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Draft", &doc))).await;

  let (status, _) = answered(ran.as_reader("DELETE", "/notes/a1", "1", "member")).await;
  assert_eq!(status, StatusCode::NO_CONTENT);
  let (_, live) = answered(ran.as_reader("GET", "/notes", "1", "member")).await;
  assert_eq!(live["items"].as_array().expect("a page").len(), 0);
  let (_, trash) = answered(ran.as_reader("GET", "/notes?deleted=true", "1", "member")).await;
  assert_eq!(trash["items"].as_array().expect("a page").len(), 1);
  assert!(trash["items"][0]["deletedAt"].as_i64().is_some());

  // A write on a trashed note is refused; the editor must restore it first.
  let (status, refusal) = answered(
    ran
      .as_reader("PATCH", "/notes/a1", "1", "member")
      .json(&json!({ "version": 1, "doc": &doc })),
  )
  .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert_eq!(refusal["code"], "trashed");

  let (status, meta) = answered(
    ran
      .as_reader("PATCH", "/notes/a1", "1", "member")
      .json(&json!({ "version": 1, "restore": true })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  assert!(meta["deletedAt"].is_null());
  assert_eq!(meta["version"], 1, "a restore holds no version");

  // Purge only stands for a trashed note; the second trash lets it.
  let (status, refusal) = answered(ran.as_reader("DELETE", "/notes/a1?purge=true", "1", "member")).await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert_eq!(refusal["code"], "not-trashed");
  answered(ran.as_reader("DELETE", "/notes/a1", "1", "member")).await;
  let (status, _) = answered(ran.as_reader("DELETE", "/notes/a1?purge=true", "1", "member")).await;
  assert_eq!(status, StatusCode::NO_CONTENT);
  let (_, trash) = answered(ran.as_reader("GET", "/notes?deleted=true", "1", "member")).await;
  assert_eq!(trash["items"].as_array().expect("a page").len(), 0);

  let (status, _) = answered(ran.as_reader("DELETE", "/notes/gone", "1", "member")).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn health_answers_the_ready_service_to_its_credential() {
  let (_scratch, ran) = running("health").await;
  let (status, health) = answered(ran.call("GET", "/health")).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(health["ready"], true);
  assert!(health["reason"].is_null());
  assert_eq!(health["version"], env!("CARGO_PKG_VERSION"));

  let client = reqwest::Client::builder().no_proxy().build().expect("a client");
  let (status, _) = answered(client.get(format!("{}{}", ran.address, "/health"))).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_store_keeps_its_notes_across_a_restart() {
  let scratch = Scratch::make("restart");
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  let doc = sample_doc(1);
  answered(ran.as_reader("POST", "/notes", "1", "member").json(&note_body("a1", "Kept", &doc))).await;
  drop(ran);

  // The same settings over the same file, on a port of its own: the note stands where it was left.
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  let (_, note) = answered(ran.as_reader("GET", "/notes/a1", "1", "member")).await;
  assert_eq!(note["title"], "Kept");
  assert_eq!(body_of(&note["doc"]), body_of(&doc));
}
