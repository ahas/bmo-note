//! Each account's folders and its notes' places among them (`docs/api.md`, 「Folders」): nested, named, the
//! owner's alone, a note in one folder or in none, and a folder's deletion moving what it holds up.

use axum::http::StatusCode;
use serde_json::{Value, json};

use crate::support::{Ran, Scratch, answered, held_port, note_body, sample_doc, settings};

const OWNER: &str = "1";
const MEMBER: &str = "2";

async fn running(name: &str) -> (Scratch, Ran) {
  let scratch = Scratch::make(name);
  let (listener, listen) = held_port().await;
  let ran = Ran::start(settings(&scratch, listen), listener).await;
  (scratch, ran)
}

async fn folder(ran: &Ran, id: &str, name: &str, parent: Option<&str>) -> (StatusCode, Value) {
  answered(
    ran
      .as_reader("POST", "/folders", OWNER, "member")
      .json(&json!({ "id": id, "name": name, "parent": parent })),
  )
  .await
}

async fn note(ran: &Ran, id: &str, title: &str) {
  let (status, _) = answered(ran.as_reader("POST", "/notes", OWNER, "member").json(&note_body(
    id,
    title,
    &sample_doc(1),
  )))
  .await;
  assert_eq!(status, StatusCode::CREATED);
}

async fn filed(ran: &Ran, note: &str, folder: Option<&str>) -> (StatusCode, Value) {
  answered(
    ran
      .as_reader("PUT", &format!("/notes/{note}/folder"), OWNER, "member")
      .json(&json!({ "folder": folder })),
  )
  .await
}

/// The folders as `id<parent:name`, in the order the list answers them.
async fn tree(ran: &Ran) -> Vec<String> {
  let (status, page) = answered(ran.as_reader("GET", "/folders", OWNER, "member")).await;
  assert_eq!(status, StatusCode::OK);
  page["items"]
    .as_array()
    .expect("a page of folders")
    .iter()
    .map(|row| {
      format!(
        "{}<{}:{}",
        row["id"].as_str().unwrap_or(""),
        row["parent"].as_str().unwrap_or("-"),
        row["name"].as_str().unwrap_or("")
      )
    })
    .collect()
}

/// The ids of the owner's live notes a list with `query` answers.
async fn listed(ran: &Ran, query: &str) -> Vec<String> {
  let (status, page) =
    answered(ran.as_reader("GET", &format!("/notes?sort=title&{query}"), OWNER, "member")).await;
  assert_eq!(status, StatusCode::OK, "{page}");
  page["items"]
    .as_array()
    .expect("a page of notes")
    .iter()
    .map(|row| row["id"].as_str().unwrap_or("").to_owned())
    .collect()
}

#[tokio::test]
async fn folders_nest_by_name_and_hold_the_notes_moved_into_them() {
  let (_scratch, ran) = running("folders").await;
  assert_eq!(folder(&ran, "work", "Work", None).await.0, StatusCode::CREATED);
  assert_eq!(folder(&ran, "home", "home", None).await.0, StatusCode::CREATED);
  let (status, made) = folder(&ran, "plans", "  Plans \t 2027 ", Some("work")).await;
  assert_eq!((status, made["name"].as_str()), (StatusCode::CREATED, Some("Plans 2027")));
  // Made again at the same id, the folder stands as it stood.
  let (status, again) = folder(&ran, "plans", "Other", None).await;
  assert_eq!((status, again["name"].as_str()), (StatusCode::OK, Some("Plans 2027")));
  assert_eq!(tree(&ran).await, vec!["home<-:home", "plans<work:Plans 2027", "work<-:Work"]);

  note(&ran, "a", "Alpha").await;
  note(&ran, "b", "Beta").await;
  note(&ran, "c", "Gamma").await;
  let (status, moved) = filed(&ran, "a", Some("plans")).await;
  assert_eq!((status, moved["folder"].as_str()), (StatusCode::OK, Some("plans")));
  assert_eq!(moved["version"].as_i64(), Some(1), "a move writes nothing else of the note");
  assert_eq!(filed(&ran, "b", Some("work")).await.0, StatusCode::OK);

  assert_eq!(listed(&ran, "folder=plans").await, vec!["a"]);
  assert_eq!(listed(&ran, "folder=work").await, vec!["b"]);
  assert_eq!(listed(&ran, "folder=").await, vec!["c"], "an empty folder lists the notes in none");
  assert_eq!(listed(&ran, "").await, vec!["a", "b", "c"], "no folder named lists every note");

  // Out of its folder again.
  let (status, out) = filed(&ran, "b", None).await;
  assert_eq!((status, &out["folder"]), (StatusCode::OK, &Value::Null));
  assert_eq!(listed(&ran, "folder=").await, vec!["b", "c"]);

  // A note made in a folder stands there, and a copy of it stands beside it.
  let (status, inside) = answered(
    ran
      .as_reader("POST", "/notes", OWNER, "member")
      .json(&json!({ "id": "d", "doc": sample_doc(2), "folder": "home" })),
  )
  .await;
  assert_eq!((status, inside["folder"].as_str()), (StatusCode::CREATED, Some("home")));
  let (status, copy) = answered(
    ran
      .as_reader("POST", "/notes/d/duplicate", OWNER, "member")
      .json(&json!({ "id": "d2", "title": "Copy" })),
  )
  .await;
  assert_eq!((status, copy["folder"].as_str()), (StatusCode::CREATED, Some("home")));

  // The search reads every folder.
  let (_, found) = answered(ran.as_reader("GET", "/notes/search?q=Alpha", OWNER, "member")).await;
  assert_eq!(found["items"][0]["id"].as_str(), Some("a"));
}

#[tokio::test]
async fn a_folder_moves_but_never_under_itself_nor_past_the_last_level() {
  let (_scratch, ran) = running("folders-moves").await;
  folder(&ran, "a", "A", None).await;
  folder(&ran, "b", "B", Some("a")).await;
  folder(&ran, "c", "C", None).await;

  let change =
    |id: &str, body: Value| ran.as_reader("PATCH", &format!("/folders/{id}"), OWNER, "member").json(&body);
  let (status, renamed) = answered(change("c", json!({ "name": "Archive" }))).await;
  assert_eq!(
    (status, renamed["name"].as_str(), &renamed["parent"]),
    (StatusCode::OK, Some("Archive"), &Value::Null)
  );
  let (status, moved) = answered(change("a", json!({ "parent": "c" }))).await;
  assert_eq!((status, moved["parent"].as_str()), (StatusCode::OK, Some("c")));
  assert_eq!(tree(&ran).await, vec!["a<c:A", "c<-:Archive", "b<a:B"]);

  let (status, refused) = answered(change("c", json!({ "parent": "b" }))).await;
  assert_eq!(
    (status, refused["code"].as_str()),
    (StatusCode::UNPROCESSABLE_ENTITY, Some("folder-cycle"))
  );
  let (status, refused) = answered(change("a", json!({ "parent": "a" }))).await;
  assert_eq!(refused["code"].as_str(), Some("folder-cycle"), "{status}");
  let (status, refused) = answered(change("a", json!({ "parent": "nowhere" }))).await;
  assert_eq!(
    (status, refused["code"].as_str()),
    (StatusCode::UNPROCESSABLE_ENTITY, Some("no-folder"))
  );
  let (status, _) = answered(change("missing", json!({ "name": "X" }))).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let (status, _) = answered(change("a", json!({ "name": "  " }))).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);

  // Back to the top, with a null parent.
  let (status, top) = answered(change("a", json!({ "parent": null }))).await;
  assert_eq!((status, &top["parent"]), (StatusCode::OK, &Value::Null));

  // Eight levels stand; a ninth is refused, made or moved.
  let mut parent = "c".to_owned();
  for level in 2..=8 {
    let id = format!("l{level}");
    assert_eq!(folder(&ran, &id, &id, Some(&parent)).await.0, StatusCode::CREATED, "level {level}");
    parent = id;
  }
  let (status, refused) = folder(&ran, "l9", "l9", Some(&parent)).await;
  assert_eq!((status, refused["code"].as_str()), (StatusCode::UNPROCESSABLE_ENTITY, Some("too-deep")));
  // `a` holds `b`: two levels, which fit under the seventh level and not under the eighth.
  let (status, refused) = answered(change("a", json!({ "parent": "l7" }))).await;
  assert_eq!(refused["code"].as_str(), Some("too-deep"), "{status}");
  assert_eq!(answered(change("a", json!({ "parent": "l6" }))).await.0, StatusCode::OK);
}

#[tokio::test]
async fn deleting_a_folder_moves_what_it_holds_up() {
  let (_scratch, ran) = running("folders-delete").await;
  folder(&ran, "outer", "Outer", None).await;
  folder(&ran, "mid", "Mid", Some("outer")).await;
  folder(&ran, "inner", "Inner", Some("mid")).await;
  note(&ran, "live", "Live").await;
  note(&ran, "gone", "Trashed").await;
  filed(&ran, "live", Some("mid")).await;
  filed(&ran, "gone", Some("mid")).await;
  let (status, _) = answered(ran.as_reader("DELETE", "/notes/gone", OWNER, "member")).await;
  assert_eq!(status, StatusCode::NO_CONTENT);

  let (status, _) = answered(ran.as_reader("DELETE", "/folders/mid", OWNER, "member")).await;
  assert_eq!(status, StatusCode::NO_CONTENT);
  assert_eq!(tree(&ran).await, vec!["inner<outer:Inner", "outer<-:Outer"]);
  assert_eq!(listed(&ran, "folder=outer").await, vec!["live"]);
  // The trashed note moved up with it, and comes back into the folder it now stands in.
  let (status, restored) = answered(
    ran
      .as_reader("PATCH", "/notes/gone", OWNER, "member")
      .json(&json!({ "version": 1, "restore": true })),
  )
  .await;
  assert_eq!((status, restored["folder"].as_str()), (StatusCode::OK, Some("outer")));

  // Deleting the top folder moves its notes to the top; deleting one that does not stand answers the same.
  let (status, _) = answered(ran.as_reader("DELETE", "/folders/outer", OWNER, "member")).await;
  assert_eq!(status, StatusCode::NO_CONTENT);
  assert_eq!(listed(&ran, "folder=").await, vec!["live", "gone"]);
  assert_eq!(tree(&ran).await, vec!["inner<-:Inner"]);
  let (status, _) = answered(ran.as_reader("DELETE", "/folders/outer", OWNER, "member")).await;
  assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn folders_are_the_owners_alone_and_a_shared_note_keeps_its_sharing() {
  let (_scratch, ran) = running("folders-own").await;
  folder(&ran, "private", "Private", None).await;
  note(&ran, "n", "Shared one").await;
  filed(&ran, "n", Some("private")).await;
  let (status, _) = answered(
    ran
      .as_reader("POST", "/notes/n/members", OWNER, "member")
      .json(&json!({ "users": [MEMBER], "permission": "edit" })),
  )
  .await;
  assert_eq!(status, StatusCode::OK);

  // The member reads the note, its folder untold, and finds it in their shared view.
  let (status, read) =
    answered(ran.as_reader("GET", &format!("/notes/n?owner={OWNER}"), MEMBER, "member")).await;
  assert_eq!((status, &read["folder"]), (StatusCode::OK, &Value::Null));
  let (_, shared) = answered(ran.as_reader("GET", "/notes?shared=true", MEMBER, "member")).await;
  assert_eq!(
    (shared["items"][0]["id"].as_str(), &shared["items"][0]["folder"]),
    (Some("n"), &Value::Null)
  );
  // The owner's folders are not the member's: none listed, none to file into, and the note is not theirs to move.
  let (_, theirs) = answered(ran.as_reader("GET", "/folders", MEMBER, "member")).await;
  assert_eq!(theirs["items"], json!([]));
  let (status, _) = answered(
    ran
      .as_reader("PUT", &format!("/notes/n/folder?owner={OWNER}"), MEMBER, "member")
      .json(&json!({ "folder": null })),
  )
  .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, refused) = answered(ran.as_reader("GET", "/notes?folder=private", MEMBER, "member")).await;
  assert_eq!(
    (status, refused["code"].as_str()),
    (StatusCode::UNPROCESSABLE_ENTITY, Some("no-folder"))
  );

  // A folder narrows the owner's live notes alone.
  let (status, _) =
    answered(ran.as_reader("GET", "/notes?folder=private&shared=true", OWNER, "member")).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  let (status, refused) = filed(&ran, "n", Some("nowhere")).await;
  assert_eq!(
    (status, refused["code"].as_str()),
    (StatusCode::UNPROCESSABLE_ENTITY, Some("no-folder"))
  );
}
