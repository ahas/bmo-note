//! What a reader keeps for themselves (`docs/api.md`, 「Bookmarks」, 「What was opened」): bookmarks and the
//! record of what they opened, each the calling account's own, answered only for what it reads live.

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

/// The bookmarks an account reads, each by its kind and what it names.
async fn bookmarks_of(ran: &Ran, account: &str) -> Vec<String> {
  let (status, page) = answered(ran.as_reader("GET", "/bookmarks", account, "member")).await;
  assert_eq!(status, StatusCode::OK);
  page["items"]
    .as_array()
    .expect("a page of bookmarks")
    .iter()
    .map(|row| match row["kind"].as_str().unwrap_or("") {
      "folder" => format!("folder {}", row["folder"]["name"].as_str().unwrap_or("")),
      kind => format!(
        "{kind} {}/{}{}",
        row["note"]["owner"].as_str().unwrap_or(""),
        row["note"]["id"].as_str().unwrap_or(""),
        row["block"].as_str().map(|block| format!("#{block}")).unwrap_or_default()
      ),
    })
    .collect()
}

async fn bookmarked(ran: &Ran, account: &str, made: Value) -> (StatusCode, Value) {
  answered(ran.as_reader("POST", "/bookmarks", account, "member").json(&made)).await
}

/// A note whose blocks carry block ids, each line a paragraph of its own.
fn blocked_doc(lines: &[(&str, &str)]) -> Value {
  let mut content = vec![json!({ "type": "title", "content": [{ "type": "text", "text": "Lines" }] })];
  for (block, words) in lines {
    content.push(json!({ "type": "paragraph", "attrs": { "block": block }, "content": [{ "type": "text", "text": words }] }));
  }
  json!({ "type": "doc", "content": content })
}

#[tokio::test]
async fn bookmarks_are_each_accounts_own_in_the_order_made() {
  let (_scratch, ran) = running("bookmarks").await;
  made(&ran, OWNER, "a", "First").await;
  made(&ran, OWNER, "b", "Second").await;
  shared_with_member(&ran, "b").await;
  let (status, folder) = answered(
    ran
      .as_reader("POST", "/folders", OWNER, "member")
      .json(&json!({ "id": "f", "name": "Plans" })),
  )
  .await;
  assert_eq!(status, StatusCode::CREATED, "{folder}");

  let (status, first) = bookmarked(&ran, OWNER, json!({ "kind": "note", "noteId": "b" })).await;
  assert_eq!(status, StatusCode::CREATED, "{first}");
  assert_eq!(
    (first["note"]["title"].as_str(), first["anchored"].as_bool()),
    (Some("Second"), Some(true))
  );
  assert_eq!(
    bookmarked(&ran, OWNER, json!({ "kind": "folder", "folderId": "f" })).await.0,
    StatusCode::CREATED
  );
  assert_eq!(
    bookmarked(&ran, OWNER, json!({ "kind": "note", "noteId": "a" })).await.0,
    StatusCode::CREATED
  );
  // The same bookmark made again stands as it stood, in its place.
  let (status, again) =
    bookmarked(&ran, OWNER, json!({ "kind": "note", "noteId": "b", "noteOwner": OWNER })).await;
  assert_eq!((status, again["id"].as_str()), (StatusCode::OK, first["id"].as_str()));
  assert_eq!(bookmarks_of(&ran, OWNER).await, vec!["note 1/b", "folder Plans", "note 1/a"]);

  // The member bookmarks the note shared with them; the owner's bookmarks are not theirs to see, and the
  // owner's folders are not theirs to bookmark.
  assert!(bookmarks_of(&ran, MEMBER).await.is_empty());
  let (status, theirs) =
    bookmarked(&ran, MEMBER, json!({ "kind": "note", "noteId": "b", "noteOwner": OWNER })).await;
  assert_eq!(status, StatusCode::CREATED);
  assert_eq!(
    (theirs["note"]["access"].as_str(), &theirs["note"]["folder"]),
    (Some("read"), &Value::Null)
  );
  assert_eq!(bookmarks_of(&ran, MEMBER).await, vec!["note 1/b"]);
  let (status, _) = bookmarked(&ran, MEMBER, json!({ "kind": "folder", "folderId": "f" })).await;
  assert_eq!(status, StatusCode::NOT_FOUND);

  // A note not shared with the caller cannot be bookmarked, and stands as no note at all.
  let (status, _) =
    bookmarked(&ran, STRANGER, json!({ "kind": "note", "noteId": "a", "noteOwner": OWNER })).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let (status, _) = bookmarked(&ran, OWNER, json!({ "kind": "line", "noteId": "a" })).await;
  assert_eq!(status, StatusCode::BAD_REQUEST, "a line names its block");

  // Taking one off is the caller's own; another's id takes nothing.
  let id = first["id"].as_str().expect("an id");
  assert_eq!(
    status_of(ran.as_reader("DELETE", &format!("/bookmarks/{id}"), MEMBER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(bookmarks_of(&ran, OWNER).await, vec!["note 1/b", "folder Plans", "note 1/a"]);
  assert_eq!(
    status_of(ran.as_reader("DELETE", &format!("/bookmarks/{id}"), OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(bookmarks_of(&ran, OWNER).await, vec!["folder Plans", "note 1/a"]);

  // A folder deleted takes its bookmarks.
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/folders/f", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(bookmarks_of(&ran, OWNER).await, vec!["note 1/a"]);
}

#[tokio::test]
async fn a_line_bookmark_follows_its_block_and_says_when_it_is_gone() {
  let (_scratch, ran) = running("bookmarks-lines").await;
  let doc = blocked_doc(&[("one", "Buy milk"), ("two", "Call the plumber")]);
  let (status, _) =
    answered(ran.as_reader("POST", "/notes", OWNER, "member").json(&json!({ "id": "n", "doc": doc })))
      .await;
  assert_eq!(status, StatusCode::CREATED);
  let (status, line) = bookmarked(
    &ran,
    OWNER,
    json!({ "kind": "line", "noteId": "n", "block": "two", "quote": "Call the plumber" }),
  )
  .await;
  assert_eq!(status, StatusCode::CREATED, "{line}");
  assert_eq!(
    (line["quote"].as_str(), line["anchored"].as_bool()),
    (Some("Call the plumber"), Some(true))
  );

  // The words change and the block moves to the top: the bookmark reads the block's words now.
  let moved = blocked_doc(&[("two", "Call the plumber at nine"), ("one", "Buy milk")]);
  let (status, _) = answered(
    ran
      .as_reader("PATCH", "/notes/n", OWNER, "member")
      .json(&json!({ "version": 1, "doc": moved })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let (_, page) = answered(ran.as_reader("GET", "/bookmarks", OWNER, "member")).await;
  assert_eq!(page["items"][0]["quote"].as_str(), Some("Call the plumber at nine"));
  assert_eq!(page["items"][0]["anchored"].as_bool(), Some(true));

  // The block deleted: the bookmark stands, says so, and keeps the words it was made with.
  let gone = blocked_doc(&[("one", "Buy milk")]);
  let (status, _) = answered(
    ran
      .as_reader("PATCH", "/notes/n", OWNER, "member")
      .json(&json!({ "version": 2, "doc": gone })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let (_, page) = answered(ran.as_reader("GET", "/bookmarks", OWNER, "member")).await;
  assert_eq!(page["items"][0]["anchored"].as_bool(), Some(false));
  assert_eq!(page["items"][0]["quote"].as_str(), Some("Call the plumber"));
  assert_eq!(page["items"][0]["block"].as_str(), Some("two"));
}

#[tokio::test]
async fn a_bookmarked_note_drops_out_when_its_reader_no_longer_reads_it() {
  let (_scratch, ran) = running("bookmarks-revoked").await;
  made(&ran, OWNER, "b", "Shared").await;
  shared_with_member(&ran, "b").await;
  let (status, theirs) =
    bookmarked(&ran, MEMBER, json!({ "kind": "note", "noteId": "b", "noteOwner": OWNER })).await;
  assert_eq!(status, StatusCode::CREATED);
  assert_eq!(
    bookmarked(&ran, OWNER, json!({ "kind": "note", "noteId": "b" })).await.0,
    StatusCode::CREATED
  );

  assert_eq!(
    status_of(ran.as_reader("DELETE", &format!("/notes/b/members/{MEMBER}"), OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert!(bookmarks_of(&ran, MEMBER).await.is_empty());
  // The bookmark it left is still the member's to take off.
  let id = theirs["id"].as_str().expect("an id");
  assert_eq!(
    status_of(ran.as_reader("DELETE", &format!("/bookmarks/{id}"), MEMBER, "member")).await,
    StatusCode::NO_CONTENT
  );

  // Trashed, it leaves the owner's bookmarks too, and a bookmark is refused; restored, it comes back.
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/b", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert!(bookmarks_of(&ran, OWNER).await.is_empty());
  let (status, refused) = bookmarked(&ran, OWNER, json!({ "kind": "note", "noteId": "b" })).await;
  assert_eq!((status, refused["code"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("trashed")));
  let (status, _) = answered(
    ran
      .as_reader("PATCH", "/notes/b", OWNER, "member")
      .json(&json!({ "version": 1, "restore": true })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(bookmarks_of(&ran, OWNER).await, vec!["note 1/b"]);

  // A purge takes every bookmark of the note.
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/b", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/b?purge=true", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  made(&ran, OWNER, "b", "Again").await;
  assert!(bookmarks_of(&ran, OWNER).await.is_empty());
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
