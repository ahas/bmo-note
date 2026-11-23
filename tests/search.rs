//! The search over the notes a reader reads (`docs/api.md`, 「Search」): what it finds — Korean by any run
//! of three characters, a short term by the title, a quoted phrase exactly — where it marks what it found,
//! and above all whose notes it answers. A search answers an owner's own notes, the notes member-shared
//! with the caller while they live, and a trashed note to its owner alone; never anything else of
//! another account's, however the query is put.

use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, doc_of, held_port, note_body, sample_doc, settings};

/// The owner, a member a note is shared with, and a stranger it is not.
const OWNER: &str = "1";
const MEMBER: &str = "2";
const STRANGER: &str = "3";

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  (scratch, ran)
}

/// A note of `owner`'s made and saved, its document holding `title` and one paragraph a line of `text`.
async fn written(ran: &Ran, owner: &str, id: &str, title: &str, text: &str) {
  let (status, made) = answered(ran.as_reader("POST", "/notes", owner, "member").json(&note_body(
    id,
    title,
    &sample_doc(1),
  )))
  .await;
  assert_eq!(status, StatusCode::CREATED, "{made}");
  let lines: Vec<&str> = text.split('\n').collect();
  let (status, saved) = answered(
    ran
      .as_reader("PATCH", &format!("/notes/{id}"), owner, "member")
      .json(&json!({ "version": 1, "doc": doc_of(title, &lines) })),
  )
  .await;
  assert_eq!(status, StatusCode::OK, "{saved}");
}

/// A search as `reader` puts it, answered.
async fn searched(ran: &Ran, reader: &str, query: &str) -> (StatusCode, Value) {
  answered(ran.as_reader("GET", &format!("/notes/search?{query}"), reader, "member")).await
}

/// The `owner/id` of every row a search answered, in order.
fn found(page: &Value) -> Vec<String> {
  page["items"]
    .as_array()
    .expect("a page of rows")
    .iter()
    .map(|row| format!("{}/{}", row["owner"].as_str().unwrap_or(""), row["id"].as_str().unwrap_or("")))
    .collect()
}

fn q(words: &str) -> String {
  let mut query = String::from("q=");
  query.push_str(&words.bytes().map(|byte| format!("%{byte:02X}")).collect::<String>());
  query
}

/// Each account holds notes holding the same words: the owner's live, shared and trashed ones, the
/// stranger's own.
async fn three_accounts(name: &str) -> (Scratch, Ran) {
  let (scratch, ran) = running(name).await;
  written(&ran, OWNER, "own", "주간 회의록", "프로젝트 일정과 예산을 정리했다").await;
  written(&ran, OWNER, "shared", "공유 회의록", "프로젝트 위험과 일정을 나눴다").await;
  written(&ran, OWNER, "gone", "지난 회의록", "프로젝트 마감은 지났다").await;
  written(&ran, STRANGER, "theirs", "남의 회의록", "프로젝트 비밀 일정").await;
  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes/shared/members", OWNER, "member")
      .json(&json!({ "users": [MEMBER], "permission": "read" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let status = ran
    .as_reader("DELETE", "/notes/gone", OWNER, "member")
    .send()
    .await
    .expect("answered")
    .status();
  assert_eq!(status, StatusCode::NO_CONTENT);
  (scratch, ran)
}

#[tokio::test]
async fn a_search_answers_the_callers_own_and_what_is_shared_with_them_and_nothing_else() {
  let (_scratch, ran) = three_accounts("search-access").await;
  let words = q("프로젝트");

  let (status, owner) = searched(&ran, OWNER, &words).await;
  assert_eq!(status, StatusCode::OK, "{owner}");
  let mut seen = found(&owner);
  seen.sort();
  assert_eq!(seen, vec!["1/own", "1/shared"]);

  let (_, member) = searched(&ran, MEMBER, &words).await;
  assert_eq!(found(&member), vec!["1/shared"]);
  assert_eq!(member["items"][0]["access"], "read");

  let (_, stranger) = searched(&ran, STRANGER, &words).await;
  assert_eq!(found(&stranger), vec!["3/theirs"]);

  // Asking for every view changes nothing of whose notes come back: the trash is the owner's alone.
  let every = format!("{words}&in=mine,shared,trash");
  let (_, owner_all) = searched(&ran, OWNER, &every).await;
  let mut seen = found(&owner_all);
  seen.sort();
  assert_eq!(seen, vec!["1/gone", "1/own", "1/shared"]);
  let (_, member_all) = searched(&ran, MEMBER, &every).await;
  assert_eq!(found(&member_all), vec!["1/shared"]);
  let (_, stranger_all) = searched(&ran, STRANGER, &every).await;
  assert_eq!(found(&stranger_all), vec!["3/theirs"]);

  // Only the shared view asked: the member's own notes are not in it, nor the owner's unshared ones.
  let (_, member_shared) = searched(&ran, MEMBER, &format!("{words}&in=shared")).await;
  assert_eq!(found(&member_shared), vec!["1/shared"]);
  let (_, owner_shared) = searched(&ran, OWNER, &format!("{words}&in=shared")).await;
  assert!(found(&owner_shared).is_empty());

  // A short term, read from the titles alone, holds to the same accounts.
  let (_, member_short) = searched(&ran, MEMBER, &q("회의")).await;
  assert_eq!(found(&member_short), vec!["1/shared"]);
  let (_, stranger_short) = searched(&ran, STRANGER, &format!("{}&in=mine,shared,trash", q("회의"))).await;
  assert_eq!(found(&stranger_short), vec!["3/theirs"]);
}

#[tokio::test]
async fn a_share_taken_back_or_a_note_trashed_leaves_the_members_search_at_once() {
  let (_scratch, ran) = three_accounts("search-revoked").await;
  let words = format!("{}&in=mine,shared,trash", q("프로젝트"));

  let status = ran
    .as_reader("DELETE", &format!("/notes/shared/members/{MEMBER}"), OWNER, "member")
    .send()
    .await
    .expect("answered")
    .status();
  assert_eq!(status, StatusCode::NO_CONTENT);
  let (_, member) = searched(&ran, MEMBER, &words).await;
  assert!(found(&member).is_empty(), "{member}");

  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes/shared/members", OWNER, "member")
      .json(&json!({ "users": [MEMBER], "permission": "edit" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let (_, member) = searched(&ran, MEMBER, &words).await;
  assert_eq!(found(&member), vec!["1/shared"]);
  assert_eq!(member["items"][0]["access"], "edit");

  let status = ran
    .as_reader("DELETE", "/notes/shared", OWNER, "member")
    .send()
    .await
    .expect("answered")
    .status();
  assert_eq!(status, StatusCode::NO_CONTENT);
  let (_, member) = searched(&ran, MEMBER, &words).await;
  assert!(found(&member).is_empty(), "a trashed note opens to its owner alone: {member}");
  let (_, owner) = searched(&ran, OWNER, &format!("{}&in=trash", q("위험과"))).await;
  assert_eq!(found(&owner), vec!["1/shared"]);

  // A purge takes the note out of every search, its owner's trash included.
  let status = ran
    .as_reader("DELETE", "/notes/shared?purge=true", OWNER, "member")
    .send()
    .await
    .expect("answered")
    .status();
  assert_eq!(status, StatusCode::NO_CONTENT);
  let (_, owner) = searched(&ran, OWNER, &format!("{}&in=trash", q("위험과"))).await;
  assert!(found(&owner).is_empty());
}

#[tokio::test]
async fn a_service_token_search_answers_for_the_owner_it_names_alone() {
  let (_scratch, ran) = three_accounts("search-service").await;
  let (status, refused) = answered(ran.call("GET", &format!("/notes/search?{}", q("프로젝트")))).await;
  assert_eq!((status, refused["code"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("no-owner")));
  let (status, member) =
    answered(ran.call("GET", &format!("/notes/search?{}&owner={MEMBER}", q("프로젝트")))).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(found(&member), vec!["1/shared"]);
}

#[tokio::test]
async fn korean_is_found_inside_a_word_and_the_match_is_marked() {
  let (_scratch, ran) = running("search-korean").await;
  written(&ran, OWNER, "k1", "분기 예산 계획", "첫 줄\n\n둘째 줄에는 마케팅예산안이 들어 있다").await;

  // Three characters in the middle of a word are found in the text, and the stretch shows where.
  let (_, page) = searched(&ran, OWNER, &q("예산안")).await;
  assert_eq!(found(&page), vec!["1/k1"]);
  let snippet = &page["items"][0]["snippet"];
  let text = snippet["text"].as_str().expect("a stretch of text");
  assert!(!text.contains('\n'), "line breaks are laid flat: {text}");
  let [start, end] = [snippet["hits"][0][0].as_u64().unwrap(), snippet["hits"][0][1].as_u64().unwrap()];
  let units: Vec<u16> = text.encode_utf16().collect();
  assert_eq!(String::from_utf16(&units[start as usize..end as usize]).unwrap(), "예산안");

  // The title's places are UTF-16 code units too.
  let (_, page) = searched(&ran, OWNER, &q("예산 계획")).await;
  assert_eq!(page["items"][0]["titleHits"], json!([[3, 5], [6, 8]]));

  // Two characters: below the index, found by the title alone.
  let (_, page) = searched(&ran, OWNER, &q("분기")).await;
  assert_eq!(found(&page), vec!["1/k1"]);
  assert!(page["items"][0]["snippet"].is_null());
  let (_, page) = searched(&ran, OWNER, &q("마케")).await;
  assert!(found(&page).is_empty(), "a short term alone reads no text");
}

#[tokio::test]
async fn a_quoted_phrase_matches_exactly_and_terms_are_all_required() {
  let (_scratch, ran) = running("search-phrase").await;
  written(&ran, OWNER, "p1", "Weekly sync", "the release plan stands").await;
  written(&ran, OWNER, "p2", "Plan review", "release the stands plan").await;

  let (_, page) = searched(&ran, OWNER, &q("\"release plan\"")).await;
  assert_eq!(found(&page), vec!["1/p1"]);
  let (_, page) = searched(&ran, OWNER, &q("release plan")).await;
  let mut seen = found(&page);
  seen.sort();
  assert_eq!(seen, vec!["1/p1", "1/p2"]);
  let (_, page) = searched(&ran, OWNER, &q("release nothing")).await;
  assert!(found(&page).is_empty());

  // Titles only, and letter case set aside.
  let (_, page) = searched(&ran, OWNER, &format!("{}&titleOnly=true", q("PLAN"))).await;
  assert_eq!(found(&page), vec!["1/p2"]);
  assert!(page["items"][0]["snippet"].is_null());
}

#[tokio::test]
async fn the_order_the_filters_and_the_pages_hold() {
  let (_scratch, ran) = running("search-order").await;
  written(&ran, OWNER, "o1", "alpha", "orchard orchard").await;
  written(&ran, OWNER, "o2", "orchard", "nothing here").await;
  written(&ran, OWNER, "o3", "gamma", "orchard").await;

  // The title weighs more than the text.
  let (_, best) = searched(&ran, OWNER, &q("orchard")).await;
  assert_eq!(found(&best)[0], "1/o2");
  // Newest changed first.
  let (_, changed) = searched(&ran, OWNER, &format!("{}&sort=changed", q("orchard"))).await;
  assert_eq!(found(&changed), vec!["1/o3", "1/o2", "1/o1"]);
  // Pages walk by how many were read.
  let (_, first) = searched(&ran, OWNER, &format!("{}&sort=changed&limit=2", q("orchard"))).await;
  assert_eq!(
    (found(&first), first["more"].clone()),
    (vec!["1/o3".to_owned(), "1/o2".to_owned()], json!(true))
  );
  let (_, second) = searched(&ran, OWNER, &format!("{}&sort=changed&limit=2&after=2", q("orchard"))).await;
  assert_eq!((found(&second), second["more"].clone()), (vec!["1/o1".to_owned()], json!(false)));
  // A moment after every change keeps nothing.
  let (_, later) = searched(&ran, OWNER, &format!("{}&since=99999999999999", q("orchard"))).await;
  assert!(found(&later).is_empty());

  // What the route refuses.
  for refused in ["q=", "q=%20%20", "q=orchard&in=everything", "q=orchard&limit=0", "q=orchard&after=-1"] {
    let (status, _) = searched(&ran, OWNER, refused).await;
    assert_eq!((refused, status), (refused, StatusCode::BAD_REQUEST));
  }
}
