//! The images a note holds: stored with it before an image block stands, read back by the owner,
//! refused past the cap or off the note, and gone with a purge (`docs/api.md`, 「Notes」).

use axum::http::StatusCode;
use serde_json::Value;

use crate::support::{Ran, Scratch, TEST_BLOB_MAX, answered, doc_bytes, held_port, note_body, settings};

/// The bytes of a test image, under the test cap.
fn image(mark: u8) -> Vec<u8> {
  vec![mark; 64]
}

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  (scratch, ran)
}

/// A note standing live under the reader.
async fn note_up(ran: &Ran, key: &str, id: &str) {
  let (status, _) = answered(ran.as_reader("POST", "/notes", key, "member").json(&note_body(
    id,
    "Imaged",
    &doc_bytes(1),
  )))
  .await;
  assert_eq!(status, StatusCode::CREATED);
}

async fn put(
  ran: &Ran,
  key: &str,
  note: &str,
  blob: &str,
  mime: &str,
  bytes: Vec<u8>,
) -> (StatusCode, Value) {
  answered(
    ran
      .as_reader("PUT", &format!("/notes/{note}/blobs/{blob}"), key, "member")
      .header("content-type", mime)
      .body(bytes),
  )
  .await
}

async fn get(ran: &Ran, key: &str, note: &str, blob: &str) -> reqwest::Response {
  ran
    .as_reader("GET", &format!("/notes/{note}/blobs/{blob}"), key, "member")
    .send()
    .await
    .expect("the service answered")
}

#[tokio::test]
async fn an_image_stands_with_its_note_and_reads_back() {
  let (_scratch, ran) = running("stand").await;
  note_up(&ran, "1", "n1").await;

  // A BlockSuite key with its base64 padding rides the route whole.
  let (status, _) = put(&ran, "1", "n1", "k=q==", "image/png", image(8)).await;
  assert_eq!(status, StatusCode::NO_CONTENT);

  let (status, _) = put(&ran, "1", "n1", "b1", "image/png", image(7)).await;
  assert_eq!(status, StatusCode::NO_CONTENT);

  let response = get(&ran, "1", "n1", "b1").await;
  assert_eq!(response.status(), StatusCode::OK);
  assert_eq!(response.headers()["content-type"], "image/png");
  assert_eq!(response.headers()["cache-control"], "private, max-age=31536000, immutable");
  assert_eq!(response.bytes().await.expect("the body").to_vec(), image(7));

  // The same id again keeps the bytes it was first given.
  let (status, _) = put(&ran, "1", "n1", "b1", "image/png", image(9)).await;
  assert_eq!(status, StatusCode::NO_CONTENT);
  assert_eq!(get(&ran, "1", "n1", "b1").await.bytes().await.expect("the body").to_vec(), image(7));
}

#[tokio::test]
async fn another_account_writes_no_image_and_reads_no_image_of_it() {
  let (_scratch, ran) = running("guard").await;
  note_up(&ran, "1", "n1").await;
  put(&ran, "1", "n1", "b1", "image/png", image(7)).await;

  let (status, refusal) = put(&ran, "9", "n1", "b2", "image/png", image(8)).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  assert_eq!(refusal["code"], "not-found");

  assert_eq!(get(&ran, "9", "n1", "b1").await.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_image_off_a_note_that_does_not_live_is_refused_and_a_trashed_notes_image_still_reads() {
  let (_scratch, ran) = running("off").await;

  // No note at all.
  let (status, refusal) = put(&ran, "1", "nope", "b1", "image/png", image(7)).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  assert_eq!(refusal["code"], "not-found");

  // A trashed note takes no write, and its stored image still reads.
  note_up(&ran, "1", "n1").await;
  put(&ran, "1", "n1", "b0", "image/png", image(6)).await;
  let trashed = ran
    .as_reader("DELETE", "/notes/n1", "1", "member")
    .send()
    .await
    .expect("the service answered");
  assert_eq!(trashed.status(), StatusCode::NO_CONTENT);

  let (status, refusal) = put(&ran, "1", "n1", "b1", "image/png", image(7)).await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert_eq!(refusal["code"], "trashed");

  assert_eq!(get(&ran, "1", "n1", "b0").await.status(), StatusCode::OK);
}

#[tokio::test]
async fn an_image_past_the_cap_is_refused_with_the_stores_code() {
  let (_scratch, ran) = running("cap").await;
  note_up(&ran, "1", "n1").await;

  // The body is read at the cap, so the refusal carries the store's code and its number however the
  // call was sent.
  let (status, refusal) = put(&ran, "1", "n1", "big", "image/png", vec![1; TEST_BLOB_MAX + 1]).await;
  assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
  assert_eq!(refusal["code"], "too-large");
}

#[tokio::test]
async fn a_body_that_names_no_image_and_an_id_that_is_not_one_are_refused() {
  let (_scratch, ran) = running("shape").await;
  note_up(&ran, "1", "n1").await;

  let (status, refusal) = put(&ran, "1", "n1", "b1", "application/pdf", image(7)).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  assert_eq!(refusal["code"], "bad-request");

  let (status, refusal) = put(&ran, "1", "n1", "not an id", "image/png", image(7)).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  assert_eq!(refusal["code"], "bad-request");
}

#[tokio::test]
async fn a_purge_takes_the_note_and_its_images() {
  let (_scratch, ran) = running("purge").await;
  note_up(&ran, "1", "n1").await;
  put(&ran, "1", "n1", "b1", "image/png", image(7)).await;

  let trashed = ran
    .as_reader("DELETE", "/notes/n1", "1", "member")
    .send()
    .await
    .expect("the service answered");
  assert_eq!(trashed.status(), StatusCode::NO_CONTENT);
  let purged = ran
    .as_reader("DELETE", "/notes/n1?purge=true", "1", "member")
    .send()
    .await
    .expect("the service answered");
  assert_eq!(purged.status(), StatusCode::NO_CONTENT);

  assert_eq!(get(&ran, "1", "n1", "b1").await.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_service_token_acts_for_the_owner_it_names() {
  let (_scratch, ran) = running("token").await;
  note_up(&ran, "1", "n1").await;

  let (status, _) = answered(
    ran
      .call("PUT", "/notes/n1/blobs/b1?owner=1")
      .header("content-type", "image/png")
      .body(image(7)),
  )
  .await;
  assert_eq!(status, StatusCode::NO_CONTENT);

  let (status, refusal) =
    answered(ran.call("PUT", "/notes/n1/blobs/b2").header("content-type", "image/png").body(image(7)))
      .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert_eq!(refusal["code"], "no-owner");
}
