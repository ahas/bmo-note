//! A note shared by its owner (`docs/api.md`, 「Sharing」): by a link its token alone reads, and with
//! members who reach it as their permission opens; a stranger refused as for a note that does not stand,
//! and an ended link or a share taken back refused again.

use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, body_of, held_port, note_body, sample_doc, settings};

/// The owner, a member and a stranger, as the console names their accounts.
const OWNER: &str = "1";
const MEMBER: &str = "2";
const STRANGER: &str = "3";

/// The bytes of the note's one image.
const IMAGE: [u8; 16] = [7; 16];

/// A service over a scratch store, with the owner's note `n1` and its image standing.
async fn shared_ground(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  let (status, _) = answered(ran.as_reader("POST", "/notes", OWNER, "member").json(&note_body(
    "n1",
    "Plans",
    &sample_doc(1),
  )))
  .await;
  assert_eq!(status, StatusCode::CREATED);
  let response = ran
    .as_reader("PUT", "/notes/n1/blobs/img1", OWNER, "member")
    .header("content-type", "image/png")
    .body(IMAGE.to_vec())
    .send()
    .await
    .expect("the image is stored");
  assert_eq!(response.status(), StatusCode::NO_CONTENT);
  (scratch, ran)
}

async fn status_of(request: reqwest::RequestBuilder) -> StatusCode {
  request.send().await.expect("the service answered").status()
}

/// The owner shares `n1` with the member at `permission`.
async fn share_with_member(ran: &Ran, permission: &str) -> Value {
  let (status, members) = answered(
    ran
      .as_reader("POST", "/notes/n1/members", OWNER, "member")
      .json(&json!({ "users": [MEMBER], "permission": permission })),
  )
  .await;
  assert_eq!(status, StatusCode::OK, "{members}");
  members
}

#[tokio::test]
async fn a_note_shared_by_link_is_read_with_its_token_alone() {
  let (_scratch, ran) = shared_ground("link").await;

  let (status, link) =
    answered(ran.as_reader("POST", "/notes/n1/link", OWNER, "member").json(&json!({}))).await;
  assert_eq!(status, StatusCode::CREATED, "{link}");
  let token = link["token"].as_str().expect("the link names its token").to_owned();
  assert_eq!(token.len(), 32);
  assert!(link["expiresAt"].is_null());
  let (status, again) =
    answered(ran.as_reader("POST", "/notes/n1/link", OWNER, "member").json(&json!({}))).await;
  assert_eq!((status, &again["token"]), (StatusCode::OK, &json!(token)));
  let (status, read) = answered(ran.as_reader("GET", "/notes/n1/link", OWNER, "member")).await;
  assert_eq!((status, &read["token"]), (StatusCode::OK, &json!(token)));

  // The share page's reads carry the console's credential with no reader behind them.
  let (status, note) = answered(ran.as_console("GET", &format!("/shares/{token}"))).await;
  assert_eq!(status, StatusCode::OK, "{note}");
  assert_eq!(note["title"], "Plans");
  assert_eq!(body_of(&note["doc"]), body_of(&sample_doc(1)));
  assert!(note.get("owner").is_none(), "a share read names nothing of the owner's account");
  let image = ran
    .as_console("GET", &format!("/shares/{token}/blobs/img1"))
    .send()
    .await
    .expect("answered");
  assert_eq!(image.status(), StatusCode::OK);
  assert_eq!(image.bytes().await.expect("the bytes read").to_vec(), IMAGE.to_vec());

  // Someone else's note is not the caller's to link, and a link never ends in the past.
  assert_eq!(
    status_of(ran.as_reader("POST", "/notes/n1/link", STRANGER, "member")).await,
    StatusCode::NOT_FOUND
  );
  let past = ran
    .as_reader("POST", "/notes/n1/link", OWNER, "member")
    .json(&json!({ "expiresAt": 1 }));
  assert_eq!(status_of(past).await, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn an_ended_link_opens_nothing() {
  let (scratch, ran) = shared_ground("link-ended").await;
  let (_, link) = answered(ran.as_reader("POST", "/notes/n1/link", OWNER, "member")).await;
  let token = link["token"].as_str().expect("a token").to_owned();

  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/n1/link", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(
    status_of(ran.as_console("GET", &format!("/shares/{token}"))).await,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    status_of(ran.as_console("GET", &format!("/shares/{token}/blobs/img1"))).await,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1/link", OWNER, "member")).await,
    StatusCode::NOT_FOUND
  );

  // A link made to end, its end moved past in the store rather than waited for, opens nothing either.
  let (status, link) = answered(
    ran
      .as_reader("POST", "/notes/n1/link", OWNER, "member")
      .json(&json!({ "expiresAt": bmo_note::model::now_ms() + 60_000 })),
  )
  .await;
  assert_eq!(status, StatusCode::CREATED);
  let token = link["token"].as_str().expect("a token").to_owned();
  assert_eq!(status_of(ran.as_console("GET", &format!("/shares/{token}"))).await, StatusCode::OK);
  let store = rusqlite::Connection::open(scratch.join("note.db")).expect("the store opens");
  store.execute("UPDATE links SET expires_at = 1", []).expect("the end is moved");
  assert_eq!(
    status_of(ran.as_console("GET", &format!("/shares/{token}"))).await,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1/link", OWNER, "member")).await,
    StatusCode::NOT_FOUND
  );

  // A link of a note in the trash opens nothing until the note is restored.
  let (_, link) = answered(ran.as_reader("POST", "/notes/n1/link", OWNER, "member")).await;
  let token = link["token"].as_str().expect("a token").to_owned();
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/n1", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(
    status_of(ran.as_console("GET", &format!("/shares/{token}"))).await,
    StatusCode::NOT_FOUND
  );
  let restore = ran
    .as_reader("PATCH", "/notes/n1", OWNER, "member")
    .json(&json!({ "version": 1, "restore": true }));
  assert_eq!(status_of(restore).await, StatusCode::OK);
  assert_eq!(status_of(ran.as_console("GET", &format!("/shares/{token}"))).await, StatusCode::OK);
}

#[tokio::test]
async fn a_member_reads_a_note_shared_with_them_and_writes_nothing() {
  let (_scratch, ran) = shared_ground("member-read").await;
  let members = share_with_member(&ran, "read").await;
  assert_eq!(members["items"][0]["user"], MEMBER);
  assert_eq!(members["items"][0]["permission"], "read");

  let (status, note) = answered(ran.as_reader("GET", "/notes/n1?owner=1", MEMBER, "member")).await;
  assert_eq!(status, StatusCode::OK, "{note}");
  assert_eq!(body_of(&note["doc"]), body_of(&sample_doc(1)));
  assert_eq!((&note["owner"], &note["access"]), (&json!(OWNER), &json!("read")));
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1/blobs/img1?owner=1", MEMBER, "member")).await,
    StatusCode::OK
  );

  let (status, shared) = answered(ran.as_reader("GET", "/notes?shared=true", MEMBER, "member")).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(shared["items"].as_array().map(Vec::len), Some(1));
  assert_eq!(
    (&shared["items"][0]["id"], &shared["items"][0]["access"]),
    (&json!("n1"), &json!("read"))
  );
  let (_, own) = answered(ran.as_reader("GET", "/notes", MEMBER, "member")).await;
  assert_eq!(own["items"], json!([]), "a note shared with the member is not the member's own");

  // Read opens the reads alone: every write and the sharing itself are the owner's.
  let save = ran
    .as_reader("PATCH", "/notes/n1?owner=1", MEMBER, "member")
    .json(&json!({ "version": 1, "doc": &sample_doc(2) }));
  assert_eq!(status_of(save).await, StatusCode::FORBIDDEN);
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/n1?owner=1", MEMBER, "member")).await,
    StatusCode::FORBIDDEN
  );
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1/members?owner=1", MEMBER, "member")).await,
    StatusCode::FORBIDDEN
  );
  assert_eq!(
    status_of(ran.as_reader("POST", "/notes/n1/link?owner=1", MEMBER, "member")).await,
    StatusCode::FORBIDDEN
  );
}

#[tokio::test]
async fn an_edit_member_saves_through_the_versioned_door() {
  let (_scratch, ran) = shared_ground("member-edit").await;
  share_with_member(&ran, "read").await;
  let (status, member) = answered(
    ran
      .as_reader("PATCH", "/notes/n1/members/2", OWNER, "member")
      .json(&json!({ "permission": "edit" })),
  )
  .await;
  assert_eq!((status, &member["permission"]), (StatusCode::OK, &json!("edit")));

  let save = ran
    .as_reader("PATCH", "/notes/n1?owner=1", MEMBER, "member")
    .json(&json!({ "version": 1, "doc": &sample_doc(2) }));
  let (status, meta) = answered(save).await;
  assert_eq!(status, StatusCode::OK, "{meta}");
  assert_eq!((&meta["version"], &meta["access"]), (&json!(2), &json!("edit")));
  let (_, note) = answered(ran.as_reader("GET", "/notes/n1", OWNER, "member")).await;
  assert_eq!(body_of(&note["doc"]), body_of(&sample_doc(2)), "the owner reads the member's save");

  let behind = ran
    .as_reader("PATCH", "/notes/n1?owner=1", MEMBER, "member")
    .json(&json!({ "version": 1, "doc": &sample_doc(3) }));
  assert_eq!(status_of(behind).await, StatusCode::CONFLICT);
  let restore = ran
    .as_reader("PATCH", "/notes/n1?owner=1", MEMBER, "member")
    .json(&json!({ "version": 2, "restore": true }));
  assert_eq!(status_of(restore).await, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_reader_the_note_is_not_shared_with_finds_no_note() {
  let (_scratch, ran) = shared_ground("stranger").await;
  share_with_member(&ran, "edit").await;

  for path in [
    "/notes/n1?owner=1",
    "/notes/n1/blobs/img1?owner=1",
    "/notes/n1/members?owner=1",
    "/notes/n1/link?owner=1",
  ] {
    assert_eq!(
      status_of(ran.as_reader("GET", path, STRANGER, "member")).await,
      StatusCode::NOT_FOUND,
      "{path}"
    );
  }
  let save = ran
    .as_reader("PATCH", "/notes/n1?owner=1", STRANGER, "member")
    .json(&json!({ "version": 1, "doc": &sample_doc(2) }));
  assert_eq!(status_of(save).await, StatusCode::NOT_FOUND);
  let (_, shared) = answered(ran.as_reader("GET", "/notes?shared=true", STRANGER, "member")).await;
  assert_eq!(shared["items"], json!([]));

  // The owner shares with people, never with itself, at a permission the dialog offers.
  let with_self = ran
    .as_reader("POST", "/notes/n1/members", OWNER, "member")
    .json(&json!({ "users": [OWNER], "permission": "read" }));
  assert_eq!(status_of(with_self).await, StatusCode::BAD_REQUEST);
  let unknown = ran
    .as_reader("POST", "/notes/n1/members", OWNER, "member")
    .json(&json!({ "users": [STRANGER], "permission": "admin" }));
  assert_eq!(status_of(unknown).await, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_share_taken_back_or_trashed_refuses_the_member_again() {
  let (_scratch, ran) = shared_ground("unshare").await;
  share_with_member(&ran, "read").await;
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1?owner=1", MEMBER, "member")).await,
    StatusCode::OK
  );

  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/n1", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1?owner=1", MEMBER, "member")).await,
    StatusCode::NOT_FOUND
  );
  let restore = ran
    .as_reader("PATCH", "/notes/n1", OWNER, "member")
    .json(&json!({ "version": 1, "restore": true }));
  assert_eq!(status_of(restore).await, StatusCode::OK);
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1?owner=1", MEMBER, "member")).await,
    StatusCode::OK
  );

  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/n1/members/2", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1?owner=1", MEMBER, "member")).await,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    status_of(ran.as_reader("GET", "/notes/n1/blobs/img1?owner=1", MEMBER, "member")).await,
    StatusCode::NOT_FOUND
  );
  let (_, shared) = answered(ran.as_reader("GET", "/notes?shared=true", MEMBER, "member")).await;
  assert_eq!(shared["items"], json!([]));
  let (_, members) = answered(ran.as_reader("GET", "/notes/n1/members", OWNER, "member")).await;
  assert_eq!(members["items"], json!([]));
}

#[tokio::test]
async fn a_member_hears_of_the_share_and_of_the_notes_shared_with_them() {
  let (_scratch, ran) = shared_ground("member-events").await;
  share_with_member(&ran, "read").await;
  let save = ran
    .as_reader("PATCH", "/notes/n1", OWNER, "member")
    .json(&json!({ "version": 1, "doc": crate::support::doc_of("Plans 2", &[]) }));
  assert_eq!(status_of(save).await, StatusCode::OK);
  assert_eq!(
    status_of(ran.as_reader("DELETE", "/notes/n1/members/2", OWNER, "member")).await,
    StatusCode::NO_CONTENT
  );

  let kinds = |page: &Value| -> Vec<String> {
    page["items"]
      .as_array()
      .expect("a page")
      .iter()
      .map(|event| event["kind"].as_str().expect("a kind").to_owned())
      .collect()
  };
  let (_, member) =
    answered(ran.as_reader("GET", "/events", MEMBER, "member").header("accept", "application/json")).await;
  assert_eq!(kinds(&member), ["note.shared", "note.saved", "note.unshared"]);
  let (_, stranger) =
    answered(ran.as_reader("GET", "/events", STRANGER, "member").header("accept", "application/json"))
      .await;
  assert_eq!(kinds(&stranger), Vec::<String>::new());
}
