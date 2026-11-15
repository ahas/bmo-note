//! What stands beside a note's document (`docs/api.md`, 「Notes」): its plain text, its icon, a copy of it,
//! the orders its lists stand in, its read from the trash — and a store from before any of it, upgraded in
//! place as it opens (`docs/design.md`, 「Storage」).

use axum::http::StatusCode;
use base64::Engine;
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, base64, doc_bytes, held_port, note_body, settings};

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
    &doc_bytes(1),
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
async fn a_text_rides_its_doc_and_a_text_alone_is_written_for_the_stored_version() {
  let (_scratch, ran) = running("text").await;
  let meta = made(&ran, OWNER, "t1", "Notes").await;
  assert_eq!((meta["indexed"].clone(), meta["icon"].clone()), (json!(false), json!("")));

  // A text with no doc is refused; one past the cap too.
  let (status, _) = answered(
    ran
      .as_reader("PATCH", "/notes/t1", OWNER, "member")
      .json(&json!({ "version": 1, "text": "alone" })),
  )
  .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  let (status, _) = answered(
    ran
      .as_reader("PUT", "/notes/t1/text", OWNER, "member")
      .json(&json!({ "version": 1, "text": "x".repeat(2048) })),
  )
  .await;
  assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);

  // A text for another version than the stored one is a conflict, answering the note as it stands.
  let (status, conflict) = answered(
    ran
      .as_reader("PUT", "/notes/t1/text", OWNER, "member")
      .json(&json!({ "version": 2, "text": "later" })),
  )
  .await;
  assert_eq!((status, conflict["code"].as_str()), (StatusCode::CONFLICT, Some("version-conflict")));
  assert_eq!(conflict["note"]["version"], 1);

  let (status, written) = answered(
    ran
      .as_reader("PUT", "/notes/t1/text", OWNER, "member")
      .json(&json!({ "version": 1, "text": "now" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!((written["indexed"].clone(), written["version"].clone()), (json!(true), json!(1)));
  assert_eq!(written["changedAt"], meta["changedAt"], "the text moves no moment");

  // A doc saved without its text leaves the note unindexed again.
  let (_, saved) = answered(
    ran
      .as_reader("PATCH", "/notes/t1", OWNER, "member")
      .json(&json!({ "version": 1, "doc": base64(&doc_bytes(4)) })),
  )
  .await;
  assert_eq!((saved["indexed"].clone(), saved["version"].clone()), (json!(false), json!(2)));

  // A member writes the text as far as their share opens writes.
  share(&ran, "t1", "read").await;
  let (status, _) = answered(
    ran
      .as_reader("PUT", &format!("/notes/t1/text?owner={OWNER}"), MEMBER, "member")
      .json(&json!({ "version": 2, "text": "member" })),
  )
  .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  share(&ran, "t1", "edit").await;
  let (status, _) = answered(
    ran
      .as_reader("PUT", &format!("/notes/t1/text?owner={OWNER}"), MEMBER, "member")
      .json(&json!({ "version": 2, "text": "member" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let (status, _) = answered(
    ran
      .as_reader("PUT", &format!("/notes/t1/text?owner={OWNER}"), STRANGER, "member")
      .json(&json!({ "version": 2, "text": "stranger" })),
  )
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
  answered(
    ran
      .as_reader("PUT", "/notes/d1/text", OWNER, "member")
      .json(&json!({ "version": 1, "text": "simmer slowly" })),
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
      copy["indexed"].clone(),
      copy["access"].clone()
    ),
    (json!(MEMBER), json!("Recipe (copy)"), json!("🍲"), json!(true), json!("owner"))
  );
  let (_, note) = answered(ran.as_reader("GET", "/notes/d2", MEMBER, "member")).await;
  assert_eq!(note["doc"], base64(&doc_bytes(1)));
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
    &doc_bytes(1),
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

#[tokio::test]
async fn a_store_from_before_the_search_is_upgraded_in_place_and_opens_unchanged_again() {
  let scratch = Scratch::make("upgrade");
  let path = scratch.join("old.db");
  {
    // The store as the unit kept it before icons, search, pins and what was opened.
    let old = rusqlite::Connection::open(&path).expect("an old store");
    old
      .execute_batch(
        "CREATE TABLE notes (owner TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, doc BLOB NOT NULL, \
         version INTEGER NOT NULL, created_at INTEGER NOT NULL, changed_at INTEGER NOT NULL, deleted_at INTEGER, \
         PRIMARY KEY (owner, id)); \
         CREATE TABLE blobs (owner TEXT NOT NULL, note TEXT NOT NULL, id TEXT NOT NULL, mime TEXT NOT NULL, \
         bytes BLOB NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (owner, note, id)); \
         INSERT INTO notes VALUES ('1', 'old', 'Kept from before', x'01', 3, 10, 20, NULL);",
      )
      .expect("the old tables");
  }
  for _ in 0..2 {
    let store = bmo_note::store::Store::open(&path).expect("the store opens");
    let meta = store.meta("1", "old", Some(false)).expect("a read").expect("the old note");
    assert_eq!(
      (meta.title.as_str(), meta.version, meta.icon.as_str(), meta.indexed),
      ("Kept from before", 3, "", false)
    );
    let (rows, _) = store
      .search(&bmo_note::store::Search {
        account: "1".to_owned(),
        views: bmo_note::store::Views {
          mine: true,
          shared: false,
          trash: false,
        },
        index_query: Some("\"before\"".to_owned()),
        short_terms: Vec::new(),
        title_only: false,
        since: None,
        order: bmo_note::wire::SearchOrder::Best,
        recent_since: 0,
        offset: 0,
        limit: 10,
      })
      .expect("a search");
    assert_eq!(rows.len(), 1, "the old note's title is searchable at once");
  }
}
