//! What stands beside a note's document (`docs/api.md`, 「Notes」): what it says, its links, its icon, a copy of it,
//! the orders its lists stand in, and its read from the trash.

use axum::http::StatusCode;
use base64::Engine;
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, body_of, held_port, note_body, sample_doc, settings};

const OWNER: &str = "1";
const MEMBER: &str = "2";
const STRANGER: &str = "3";

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  (scratch, ran)
}

async fn made(ran: &Ran, owner: &str, id: &str, title: &str) -> Value {
  let (status, meta) = answered(ran.as_reader("POST", "/notes", owner, "member").json(&note_body(
    id,
    title,
    &sample_doc(1),
  )))
  .await;
  assert_eq!(status, StatusCode::CREATED, "{meta}");
  meta
}

async fn share(ran: &Ran, id: &str, permission: &str) {
  let (status, _) = answered(
    ran
      .as_reader("POST", &format!("/notes/{id}/members"), OWNER, "member")
      .json(&json!({ "users": [MEMBER], "permission": permission })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
}

fn ids(page: &Value) -> Vec<String> {
  page["items"]
    .as_array()
    .expect("a page of rows")
    .iter()
    .map(|row| row["id"].as_str().unwrap_or("").to_owned())
    .collect()
}

#[tokio::test]
async fn the_title_text_and_links_are_read_from_the_document_on_every_write() {
  let (_scratch, ran) = running("derived").await;
  made(&ran, OWNER, "t1", "Notes").await;
  made(&ran, OWNER, "t2", "Target").await;
  let doc = json!({ "type": "doc", "content": [
    { "type": "title", "content": [{ "type": "text", "text": "Garden" }] },
    { "type": "paragraph", "content": [
      { "type": "text", "text": "tomatoes by the fence, see " },
      { "type": "mention", "attrs": { "id": "t2", "owner": OWNER, "label": "Target" } }
    ] },
    { "type": "table", "content": [{ "type": "tableRow", "content": [
      { "type": "tableCell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "basil rows" }] }] }
    ] }] }
  ] });
  let (status, saved) = answered(
    ran
      .as_reader("PATCH", "/notes/t1", OWNER, "member")
      .json(&json!({ "version": 1, "doc": doc })),
  )
  .await;
  assert_eq!((status, saved["title"].clone()), (StatusCode::OK, json!("Garden")));
  for words in ["tomatoes", "basil", "Target"] {
    let (_, found) =
      answered(ran.as_reader("GET", &format!("/notes/search?q={words}"), OWNER, "member")).await;
    assert!(ids(&found).contains(&"t1".to_owned()), "{words} is found in the note's text");
  }
  let (_, linking) = answered(ran.as_reader("GET", "/notes/t2/backlinks", OWNER, "member")).await;
  assert_eq!(ids(&linking), vec!["t1"]);

  // A save that drops the link drops the backlink with it.
  answered(
    ran
      .as_reader("PATCH", "/notes/t1", OWNER, "member")
      .json(&json!({ "version": 2, "doc": crate::support::doc_of("Garden", &["no links"]) })),
  )
  .await;
  let (_, linking) = answered(ran.as_reader("GET", "/notes/t2/backlinks", OWNER, "member")).await;
  assert!(ids(&linking).is_empty());
}

#[tokio::test]
async fn backlinks_answer_only_live_notes_the_reader_reads() {
  let (_scratch, ran) = running("backlinks").await;
  made(&ran, OWNER, "target", "Target").await;
  share(&ran, "target", "read").await;
  let link = |id: &str| {
    json!({ "id": id, "doc": { "type": "doc", "content": [
      { "type": "title", "content": [{ "type": "text", "text": id }] },
      { "type": "paragraph", "content": [{ "type": "mention", "attrs": { "id": "target", "owner": OWNER, "label": "Target" } }] }
    ] } })
  };
  // The owner's own linking note, one the member does not read, and the member's own.
  answered(ran.as_reader("POST", "/notes", OWNER, "member").json(&link("private"))).await;
  answered(ran.as_reader("POST", "/notes", OWNER, "member").json(&link("open"))).await;
  share(&ran, "open", "read").await;
  answered(ran.as_reader("POST", "/notes", MEMBER, "member").json(&link("theirs"))).await;
  answered(ran.as_reader("POST", "/notes", OWNER, "member").json(&link("trashed"))).await;
  answered(ran.as_reader("DELETE", "/notes/trashed", OWNER, "member")).await;

  let (_, owners) = answered(ran.as_reader("GET", "/notes/target/backlinks", OWNER, "member")).await;
  let mut seen = ids(&owners);
  seen.sort();
  assert_eq!(seen, vec!["open", "private"]);
  let (_, members) =
    answered(ran.as_reader("GET", &format!("/notes/target/backlinks?owner={OWNER}"), MEMBER, "member"))
      .await;
  let mut seen = ids(&members);
  seen.sort();
  assert_eq!(seen, vec!["open", "theirs"]);
  let (status, _) =
    answered(ran.as_reader("GET", &format!("/notes/target/backlinks?owner={OWNER}"), STRANGER, "member"))
      .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_icon_is_set_and_cleared_without_moving_the_version() {
  let (_scratch, ran) = running("icon").await;
  made(&ran, OWNER, "i1", "Trip").await;
  let (status, meta) =
    answered(ran.as_reader("PUT", "/notes/i1/icon", OWNER, "member").json(&json!({ "icon": " 🌱 " })))
      .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!((meta["icon"].clone(), meta["version"].clone()), (json!("🌱"), json!(1)));
  let (_, read) = answered(ran.as_reader("GET", "/notes/i1", OWNER, "member")).await;
  assert_eq!(read["icon"], "🌱");
  let (_, page) = answered(ran.as_reader("GET", "/notes", OWNER, "member")).await;
  assert_eq!(page["items"][0]["icon"], "🌱");

  let (status, _) = answered(
    ran
      .as_reader("PUT", "/notes/i1/icon", OWNER, "member")
      .json(&json!({ "icon": "a".repeat(17) })),
  )
  .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  let (_, cleared) =
    answered(ran.as_reader("PUT", "/notes/i1/icon", OWNER, "member").json(&json!({ "icon": "" }))).await;
  assert_eq!(cleared["icon"], "");

  share(&ran, "i1", "read").await;
  let (status, _) = answered(
    ran
      .as_reader("PUT", &format!("/notes/i1/icon?owner={OWNER}"), MEMBER, "member")
      .json(&json!({ "icon": "🌊" })),
  )
  .await;
  assert_eq!(status, StatusCode::FORBIDDEN);

  assert_eq!(
    ran
      .as_reader("DELETE", "/notes/i1", OWNER, "member")
      .send()
      .await
      .expect("answered")
      .status(),
    StatusCode::NO_CONTENT
  );
  let (status, trashed) =
    answered(ran.as_reader("PUT", "/notes/i1/icon", OWNER, "member").json(&json!({ "icon": "🌊" }))).await;
  assert_eq!((status, trashed["code"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("trashed")));
}

#[tokio::test]
async fn a_duplicate_is_the_callers_own_with_the_document_images_icon_and_text() {
  let (_scratch, ran) = running("duplicate").await;
  made(&ran, OWNER, "d1", "Recipe").await;
  let image = ran
    .as_reader("PUT", "/notes/d1/blobs/img1", OWNER, "member")
    .header("content-type", "image/png")
    .body(vec![9u8; 8])
    .send()
    .await
    .expect("answered");
  assert_eq!(image.status(), StatusCode::NO_CONTENT);
  answered(ran.as_reader("PUT", "/notes/d1/icon", OWNER, "member").json(&json!({ "icon": "🍲" }))).await;
  let commented = json!({ "type": "doc", "content": [
    { "type": "title", "content": [{ "type": "text", "text": "Recipe" }] },
    { "type": "paragraph", "content": [
      { "type": "text", "text": "simmer slowly", "marks": [{ "type": "comment", "attrs": { "thread": "th1" } }] }
    ] }
  ] });
  answered(
    ran
      .as_reader("PATCH", "/notes/d1", OWNER, "member")
      .json(&json!({ "version": 1, "doc": commented })),
  )
  .await;

  // The member copies the note shared with them into a note of their own.
  share(&ran, "d1", "read").await;
  let (status, copy) = answered(
    ran
      .as_reader("POST", &format!("/notes/d1/duplicate?owner={OWNER}"), MEMBER, "member")
      .json(&json!({ "id": "d2", "title": "Recipe (copy)" })),
  )
  .await;
  assert_eq!(status, StatusCode::CREATED, "{copy}");
  assert_eq!(
    (
      copy["owner"].clone(),
      copy["title"].clone(),
      copy["icon"].clone(),
      copy["access"].clone()
    ),
    (json!(MEMBER), json!("Recipe (copy)"), json!("🍲"), json!("owner"))
  );
  let (_, note) = answered(ran.as_reader("GET", "/notes/d2", MEMBER, "member")).await;
  assert_eq!(
    note["doc"]["content"][0]["content"][0]["text"], "Recipe (copy)",
    "the copy's title is in its document"
  );
  assert_eq!(
    body_of(&note["doc"]),
    vec![json!({ "type": "paragraph", "content": [{ "type": "text", "text": "simmer slowly" }] })],
    "the copy carries no comment marks"
  );
  let blob = ran
    .as_reader("GET", "/notes/d2/blobs/img1", MEMBER, "member")
    .send()
    .await
    .expect("answered");
  assert_eq!(blob.status(), StatusCode::OK);
  let (_, found) = answered(ran.as_reader("GET", "/notes/search?q=simmer&in=mine", MEMBER, "member")).await;
  assert_eq!(ids(&found), vec!["d2"]);

  // An id already held, a reserved word and a note the caller does not read are refused.
  let (status, _) = answered(
    ran
      .as_reader("POST", &format!("/notes/d1/duplicate?owner={OWNER}"), MEMBER, "member")
      .json(&json!({ "id": "d2", "title": "Again" })),
  )
  .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes/d1/duplicate", OWNER, "member")
      .json(&json!({ "id": "search", "title": "x" })),
  )
  .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  let (status, _) = answered(
    ran
      .as_reader("POST", &format!("/notes/d1/duplicate?owner={OWNER}"), STRANGER, "member")
      .json(&json!({ "title": "Stolen" })),
  )
  .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let (status, _) = answered(ran.as_reader("POST", "/notes", OWNER, "member").json(&note_body(
    "recent",
    "x",
    &sample_doc(1),
  )))
  .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_list_stands_in_the_order_named_and_walks_by_its_cursor() {
  let (_scratch, ran) = running("order").await;
  for (id, title) in [("n1", "banana"), ("n2", ""), ("n3", "Apple: red"), ("n4", "cherry")] {
    made(&ran, OWNER, id, title).await;
    tokio::time::sleep(std::time::Duration::from_millis(3)).await;
  }
  let (_, by_title) = answered(ran.as_reader("GET", "/notes?sort=title", OWNER, "member")).await;
  assert_eq!(ids(&by_title), vec!["n3", "n1", "n4", "n2"], "case set aside, untitled last");
  let (_, created) = answered(ran.as_reader("GET", "/notes?sort=created", OWNER, "member")).await;
  assert_eq!(ids(&created), vec!["n4", "n3", "n2", "n1"]);

  // A title cursor carries the title in base64url, so its colon parts nothing.
  let (_, first) = answered(ran.as_reader("GET", "/notes?sort=title&limit=1", OWNER, "member")).await;
  let title = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("Apple: red");
  let (_, next) =
    answered(ran.as_reader("GET", &format!("/notes?sort=title&limit=2&after={title}:n3"), OWNER, "member"))
      .await;
  assert_eq!(
    (ids(&first), ids(&next)),
    (vec!["n3".to_owned()], vec!["n1".to_owned(), "n4".to_owned()])
  );
  let empty = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("cherry");
  let (_, last) =
    answered(ran.as_reader("GET", &format!("/notes?sort=title&after={empty}:n4"), OWNER, "member")).await;
  assert_eq!(ids(&last), vec!["n2"]);

  // The shared view sorts too.
  share(&ran, "n1", "read").await;
  share(&ran, "n3", "read").await;
  let (_, shared) = answered(ran.as_reader("GET", "/notes?shared=true&sort=title", MEMBER, "member")).await;
  assert_eq!(ids(&shared), vec!["n3", "n1"]);

  let (status, _) = answered(ran.as_reader("GET", "/notes?sort=title&after=12:n1", OWNER, "member")).await;
  assert_eq!(status, StatusCode::BAD_REQUEST, "a moment does not read as a title's base64url");
  let (status, _) = answered(ran.as_reader("GET", "/notes?sort=size", OWNER, "member")).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_trashed_note_is_read_by_its_owner_alone() {
  let (_scratch, ran) = running("trash-read").await;
  made(&ran, OWNER, "g1", "Gone").await;
  share(&ran, "g1", "edit").await;
  let (status, _) = answered(ran.as_reader("GET", "/notes/g1?deleted=true", OWNER, "member")).await;
  assert_eq!(status, StatusCode::NOT_FOUND, "a live note is not read from the trash");
  assert_eq!(
    ran
      .as_reader("DELETE", "/notes/g1", OWNER, "member")
      .send()
      .await
      .expect("answered")
      .status(),
    StatusCode::NO_CONTENT
  );
  let (status, note) =
    answered(ran.as_reader("GET", "/notes/g1?deleted=true&opened=true", OWNER, "member")).await;
  assert_eq!(status, StatusCode::OK);
  assert!(note["deletedAt"].as_i64().is_some());
  let (_, recent) = answered(ran.as_reader("GET", "/notes/recent", OWNER, "member")).await;
  assert!(ids(&recent).is_empty(), "a trashed note's read records nothing");
  let (status, _) =
    answered(ran.as_reader("GET", &format!("/notes/g1?deleted=true&owner={OWNER}"), MEMBER, "member"))
      .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let (status, _) = answered(ran.as_reader("GET", "/notes/g1", OWNER, "member")).await;
  assert_eq!(status, StatusCode::NOT_FOUND, "a plain read answers the live note alone, as before");
}
