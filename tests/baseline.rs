//! The store's starting point (`docs/design.md`, 「Storage」): a new file takes the 1.0.0 baseline whole, an
//! install from the last release before 1.0.0 is read as it stands, and a file from an older release is refused
//! and left as it stands.

use std::path::Path;

use bmo_note::store::{SCHEMA, Store};

use crate::support::Scratch;

// Every object of the file as SQLite keeps it, and its user version.
fn shape(path: &Path) -> (i64, Vec<(String, String)>) {
  let connection = rusqlite::Connection::open(path).expect("the file");
  let version = connection
    .pragma_query_value(None, "user_version", |row| row.get(0))
    .expect("the version");
  let objects = connection
    .prepare("SELECT name, COALESCE(sql, '') FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .expect("the objects")
    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
    .expect("the objects")
    .collect::<rusqlite::Result<_>>()
    .expect("the objects");
  (version, objects)
}

#[test]
fn a_new_file_takes_the_baseline_whole() {
  let scratch = Scratch::make("baseline");
  let opened = scratch.join("note.db");
  drop(Store::open(&opened).expect("the store opens"));
  let laid = scratch.join("laid.db");
  rusqlite::Connection::open(&laid)
    .expect("a file")
    .execute_batch(SCHEMA)
    .expect("the baseline");

  assert_eq!(shape(&opened), shape(&laid));
  let notes: i64 = rusqlite::Connection::open(&opened)
    .expect("the file")
    .query_row("SELECT count(*) FROM notes", [], |row| row.get(0))
    .expect("the count");
  assert_eq!(notes, 0, "a new file holds no note");
}

#[test]
fn an_install_at_the_last_release_before_the_baseline_is_read_as_it_stands() {
  let scratch = Scratch::make("install");
  let path = scratch.join("note.db");
  rusqlite::Connection::open(&path)
    .expect("a file")
    .execute_batch(&format!(
      "{SCHEMA} INSERT INTO notes (owner, id, title, doc, version, created_at, changed_at) \
       VALUES ('1', 'kept', 'Kept', x'01', 3, 10, 20);"
    ))
    .expect("the install");
  let before = shape(&path);

  for _ in 0..2 {
    let store = Store::open(&path).expect("the store opens");
    let meta = store.meta("1", "kept", Some(false)).expect("a read").expect("the note");
    assert_eq!((meta.title.as_str(), meta.version, meta.folder), ("Kept", 3, None));
    assert_eq!(store.foreign_documents(), 1, "a document of another format is left as it stands");
    drop(store);
    assert_eq!(shape(&path), before);
  }
}

#[test]
fn a_file_from_an_older_release_is_refused_and_left_as_it_stands() {
  for older in [
    "CREATE TABLE notes (owner TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, doc BLOB NOT NULL, \
     version INTEGER NOT NULL, created_at INTEGER NOT NULL, changed_at INTEGER NOT NULL, deleted_at INTEGER, \
     PRIMARY KEY (owner, id)); \
     INSERT INTO notes VALUES ('1', 'old', 'Old', x'01', 1, 10, 20, NULL);",
    "CREATE TABLE pins (account TEXT NOT NULL, owner TEXT NOT NULL, note TEXT NOT NULL, \
     pinned_at INTEGER NOT NULL, PRIMARY KEY (account, owner, note)); \
     INSERT INTO pins VALUES ('1', '1', 'old', 30);",
  ] {
    let scratch = Scratch::make("older");
    let path = scratch.join("note.db");
    rusqlite::Connection::open(&path)
      .expect("a file")
      .execute_batch(older)
      .expect("the older store");
    let before = shape(&path);

    let refused = Store::open(&path).err().expect("an older store is refused");
    assert!(refused.contains("before 1.0.0"), "{refused}");
    assert_eq!(shape(&path), before);
  }
}
