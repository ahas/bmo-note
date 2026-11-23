//! The unit's own store (`docs/design.md`, 「Storage」): one SQLite file — every note of every account with
//! its document, every note's images, share link and members, every note's search text and the full-text
//! index over it, its links and its comment threads, each account's folders, bookmarks and record of what it
//! opened, and each converted note's former document. The service's truth stands here; what a document says is derived
//! from it in the same transaction that writes it.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::types::ToSql;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};

use std::collections::HashMap;

use crate::doc::{Derived, block_words, derived, parsed};
use crate::model::{CursorKey, ListCursor, fresh_id};
use crate::wire::{
  Access, Bookmark, BookmarkKind, Comment, Folder, Link, ListOrder, Member, NoteMeta, Permission,
  SearchOrder, Thread,
};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS notes (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  doc BLOB NOT NULL,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  deleted_at INTEGER,
  icon TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS notes_changed ON notes (owner, deleted_at, changed_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS blobs (
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  id TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, note, id)
);
CREATE TABLE IF NOT EXISTS links (
  token TEXT NOT NULL PRIMARY KEY,
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS links_note ON links (owner, note);
CREATE TABLE IF NOT EXISTS members (
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  member TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, note, member)
);
CREATE INDEX IF NOT EXISTS members_member ON members (member);
CREATE TABLE IF NOT EXISTS texts (
  row INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  indexed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner, note)
);
CREATE VIRTUAL TABLE IF NOT EXISTS texts_index USING fts5(
  title, body, content = 'texts', content_rowid = 'row', tokenize = 'trigram'
);
CREATE TRIGGER IF NOT EXISTS texts_added AFTER INSERT ON texts BEGIN
  INSERT INTO texts_index (rowid, title, body) VALUES (new.row, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS texts_removed AFTER DELETE ON texts BEGIN
  INSERT INTO texts_index (texts_index, rowid, title, body) VALUES ('delete', old.row, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS texts_changed AFTER UPDATE ON texts BEGIN
  INSERT INTO texts_index (texts_index, rowid, title, body) VALUES ('delete', old.row, old.title, old.body);
  INSERT INTO texts_index (rowid, title, body) VALUES (new.row, new.title, new.body);
END;
CREATE TABLE IF NOT EXISTS folders (
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  parent TEXT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, id)
);
CREATE TABLE IF NOT EXISTS bookmarks (
  account TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT '',
  block TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bookmarks_target ON bookmarks (account, kind, owner, note, folder, block);
CREATE INDEX IF NOT EXISTS bookmarks_note ON bookmarks (owner, note);
CREATE TABLE IF NOT EXISTS opened (
  account TEXT NOT NULL,
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (account, owner, note)
);
CREATE INDEX IF NOT EXISTS opened_latest ON opened (account, opened_at DESC);
CREATE INDEX IF NOT EXISTS opened_note ON opened (owner, note);
CREATE TABLE IF NOT EXISTS note_links (
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  to_owner TEXT NOT NULL,
  to_note TEXT NOT NULL,
  PRIMARY KEY (owner, note, to_owner, to_note)
);
CREATE INDEX IF NOT EXISTS note_links_to ON note_links (to_owner, to_note);
CREATE TABLE IF NOT EXISTS threads (
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  id TEXT NOT NULL,
  quote TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  PRIMARY KEY (owner, note, id)
);
CREATE TABLE IF NOT EXISTS comments (
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  thread TEXT NOT NULL,
  id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, note, id)
);
CREATE INDEX IF NOT EXISTS comments_thread ON comments (owner, note, thread, created_at);
CREATE TABLE IF NOT EXISTS legacy_docs (
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  doc BLOB NOT NULL,
  migrated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, note)
);
";

/// The tables a purge empties of the note beside its own row, each keyed by `owner` and `note`.
const BESIDE_A_NOTE: [&str; 10] = [
  "blobs",
  "links",
  "members",
  "texts",
  "bookmarks",
  "opened",
  "note_links",
  "threads",
  "comments",
  "legacy_docs",
];

/// The columns a table gained after it was first made, each with its declaration, added where an older
/// store's table lacks them (`docs/design.md`, 「Storage」).
const ADDED_COLUMNS: [(&str, &str, &str); 2] =
  [("notes", "icon", "TEXT NOT NULL DEFAULT ''"), ("notes", "folder", "TEXT")];

/// What stands on the added columns, made once they stand.
const ON_ADDED_COLUMNS: &str = "CREATE INDEX IF NOT EXISTS notes_folder ON notes (owner, folder);";

/// The favourites an earlier store kept, each turned into a note bookmark of the account that made it, at the
/// moment it was made, before their table is dropped (`docs/design.md`, 「Storage」).
const FAVOURITES_AS_BOOKMARKS: &str = "INSERT INTO bookmarks (account, id, kind, owner, note, created_at) \
  SELECT account, lower(hex(randomblob(8))), 'note', owner, note, pinned_at FROM pins WHERE true \
  ON CONFLICT DO NOTHING; DROP TABLE pins;";

/// How many levels folders stand in, the top one first.
pub const FOLDER_LEVELS: usize = 8;

/// Every note's search row, made where a note has none: its title, and no text, derived on the same
/// opening (`indexed` false until then).
const SEARCH_ROWS: &str = "INSERT INTO texts (owner, note, title) SELECT owner, id, title FROM notes WHERE true \
  ON CONFLICT (owner, note) DO NOTHING";

/// How many notes an account's record of what it opened keeps.
const OPENED_KEPT: i64 = 100;

/// A note's metadata as every read selects it, the note standing as `n`: id, owner, title, version, the two
/// moments, the document's length, the trash mark, the icon and the folder.
const META: &str = "n.id, n.owner, n.title, n.version, n.created_at, n.changed_at, length(n.doc), n.deleted_at, \
  n.icon, n.folder";

/// How many columns `META` selects; what a read selects after them starts here.
const META_COLUMNS: usize = 10;

/// What a caller holds of a note it reads beside its own: `owner` for its own, the member's permission
/// otherwise; the note's member row for the caller standing as `m`, the caller bound as `?1`.
const ACCESS: &str = "CASE WHEN n.owner = ?1 THEN 'owner' ELSE m.permission END";

/// The notes a caller reads live, beside its own: the note standing as `n`, its member row for the caller
/// as `m`, the caller bound as `?1`.
const READ_LIVE: &str = "n.deleted_at IS NULL AND (n.owner = ?1 OR m.member IS NOT NULL)";

/// A note as the store reads one, with its document.
#[derive(Clone, Debug)]
pub struct Row {
  pub meta: NoteMeta,
  pub doc: Vec<u8>,
}

impl Row {
  pub fn meta(&self) -> NoteMeta {
    self.meta.clone()
  }
}

/// How a save ended.
#[derive(Clone, Debug, PartialEq)]
pub enum Saved {
  /// The note as it stands after the save.
  Saved(NoteMeta),
  /// The note as it stands, past the version the save was made from.
  Conflict(NoteMeta),
  /// No note stands at the id, live or trashed.
  Missing,
  /// The note stands in the trash.
  Trashed,
  /// The trashed note was moved back to life.
  Restored(NoteMeta),
  /// The note stands as it stood: a restore of a live note writes nothing.
  Unchanged(NoteMeta),
}

/// How a write beside the document — an icon — ended.
#[derive(Clone, Debug, PartialEq)]
pub enum Written {
  /// The note as it stands after the write.
  Done(NoteMeta),
  /// No note stands at the id, live or trashed.
  Missing,
  /// The note stands in the trash.
  Trashed,
}

/// How a write of a folder, or of a note's place among the folders, ended.
#[derive(Clone, Debug, PartialEq)]
pub enum Filed<T> {
  /// What stands after the write, and whether it was made now.
  Done(T, bool),
  /// No folder or note stands at the id the write names.
  Missing,
  /// The folder it would stand in is not one of the account's.
  NoFolder,
  /// The folder would stand under itself or under a folder it holds.
  Cycle,
  /// The folder, or the deepest one it holds, would stand past the last level.
  TooDeep,
}

/// How a duplicate ended.
#[derive(Clone, Debug, PartialEq)]
pub enum Copied {
  /// The copy, made.
  Made(NoteMeta),
  /// No live note stands at the source.
  Missing,
  /// The caller already holds a note at the copy's id.
  Taken,
}

/// The views a search reads (`docs/api.md`, 「Search」).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Views {
  pub mine: bool,
  pub shared: bool,
  pub trash: bool,
}

/// A search as the store runs it: the account it answers for, what it matches and how it is ordered.
#[derive(Clone, Debug)]
pub struct Search {
  pub account: String,
  pub views: Views,
  /// The full-text query of the terms the index reads; none where every term is too short for it.
  pub index_query: Option<String>,
  /// The terms too short for the index, each matched as a substring.
  pub short_terms: Vec<String>,
  pub title_only: bool,
  pub since: Option<i64>,
  pub order: SearchOrder,
  /// The moment a recent change is counted from.
  pub recent_since: i64,
  pub offset: i64,
  pub limit: i64,
}

/// A note a search found, with the words its hits are read from.
#[derive(Clone, Debug)]
pub struct Found {
  pub meta: NoteMeta,
  pub title: String,
  pub body: String,
}

/// The store, one SQLite file.
#[derive(Clone)]
pub struct Store {
  connection: Arc<Mutex<Connection>>,
  /// How many notes held a document of another format as the store opened.
  foreign: usize,
}

impl Store {
  /// The store at `path`, its folder and its tables made where they do not stand, and a store from an
  /// earlier version upgraded in place (`docs/design.md`, 「Storage」).
  pub fn open(path: &Path) -> Result<Self, String> {
    if let Some(folder) = path.parent().filter(|folder| !folder.as_os_str().is_empty()) {
      std::fs::create_dir_all(folder).map_err(|why| format!("{}: {why}", folder.display()))?;
    }
    let connection = Connection::open(path).map_err(|why| format!("{}: {why}", path.display()))?;
    connection.pragma_update(None, "journal_mode", "WAL").map_err(|why| why.to_string())?;
    connection.pragma_update(None, "busy_timeout", 5000).map_err(|why| why.to_string())?;
    let foreign = upgrade(&connection).map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(Self {
      connection: Arc::new(Mutex::new(connection)),
      foreign,
    })
  }

  /// How many notes held a document not of the editor's format as the store opened: documents the earlier
  /// editor wrote that the migration has not converted (`docs/design.md`, 「What a note is」).
  pub fn foreign_documents(&self) -> usize {
    self.foreign
  }

  fn with<T>(&self, work: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let connection = self.connection.lock().map_err(|_| "the store's lock is poisoned".to_owned())?;
    work(&connection).map_err(|why| format!("the store: {why}"))
  }

  /// The live (`deleted` false) or trashed (true) notes of one account in `order`, as one page: at most
  /// `limit` rows and whether anything stands past them. `folder` keeps the notes standing in the folder it
  /// names, or, empty, in none; none keeps every note.
  pub fn list(
    &self,
    owner: &str,
    deleted: bool,
    folder: Option<&str>,
    order: ListOrder,
    after: Option<&ListCursor>,
    limit: i64,
  ) -> Result<(Vec<NoteMeta>, bool), String> {
    self.with(|connection| {
      let live = if deleted { "n.deleted_at IS NOT NULL" } else { "n.deleted_at IS NULL" };
      let mut given: Vec<Box<dyn ToSql>> = vec![Box::new(owner.to_owned())];
      let placed = match folder {
        None => String::new(),
        Some("") => "AND n.folder IS NULL".to_owned(),
        Some(folder) => {
          given.push(Box::new(folder.to_owned()));
          format!("AND n.folder = ?{}", given.len())
        }
      };
      let live = format!("{live} {placed}");
      let walked = walked(order, after, false, &mut given);
      given.push(Box::new(limit + 1));
      let sql = format!(
        "SELECT {META} FROM notes n WHERE n.owner = ?1 AND {live} {walked} ORDER BY {} LIMIT ?{}",
        ordered(order, false),
        given.len()
      );
      let mut statement = connection.prepare(&sql)?;
      let metas = statement
        .query_map(params_from_iter(given.iter()), meta_of)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
      Ok(paged(metas, limit))
    })
  }

  /// One account's note with its document, where one stands at `id` and lives or rests in the trash as
  /// `want_deleted` says.
  pub fn note(&self, owner: &str, id: &str, want_deleted: Option<bool>) -> Result<Option<Row>, String> {
    self.with(|connection| {
      Ok(found(connection, owner, id)?.filter(|row| want_deleted == Some(row.meta.deleted_at.is_some())))
    })
  }

  /// One account's note metadata, where one stands at `id` and lives or rests in the trash as
  /// `want_deleted` says.
  pub fn meta(
    &self,
    owner: &str,
    id: &str,
    want_deleted: Option<bool>,
  ) -> Result<Option<NoteMeta>, String> {
    Ok(
      self
        .with(|connection| found(connection, owner, id))?
        .filter(|row| want_deleted == Some(row.meta.deleted_at.is_some()))
        .map(|row| row.meta),
    )
  }

  /// A note made, with its search row, in `folder` or in none. Answers its metadata and whether the row was
  /// made now; where the account already holds one at `id`, the note as it stands, trashed included.
  pub fn create(
    &self,
    owner: &str,
    id: &str,
    doc: &[u8],
    said: &Derived,
    folder: Option<&str>,
    at: i64,
  ) -> Result<(NoteMeta, bool), String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let changed = transaction.execute(
        "INSERT INTO notes (owner, id, title, doc, version, created_at, changed_at, deleted_at, folder) \
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, NULL, ?6) ON CONFLICT (owner, id) DO NOTHING",
        params![owner, id, said.title, doc, at, folder],
      )?;
      if changed == 1 {
        write_derived(&transaction, owner, id, said)?;
      }
      transaction.commit()?;
      let row = found(connection, owner, id)?.expect("the row stands after the insert");
      Ok((row.meta, changed == 1))
    })
  }

  /// A save of a note: `version` is the version the writer read; a save from behind the stored one
  /// answers the note as it stands. A restore writes no document and holds no version. A document saved
  /// writes what it says beside it: its title, its search text and its links.
  pub fn save(
    &self,
    owner: &str,
    id: &str,
    doc: Option<(&[u8], &Derived)>,
    version: i64,
    restore: bool,
    at: i64,
  ) -> Result<Saved, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let Some(current) = found(&transaction, owner, id)? else {
        return Ok(Saved::Missing);
      };
      if current.meta.deleted_at.is_some() {
        if !restore {
          return Ok(Saved::Trashed);
        }
        transaction
          .execute("UPDATE notes SET deleted_at = NULL WHERE owner = ?1 AND id = ?2", params![owner, id])?;
        transaction.commit()?;
        return Ok(Saved::Restored(NoteMeta {
          deleted_at: None,
          ..current.meta
        }));
      }
      if version < current.meta.version {
        return Ok(Saved::Conflict(current.meta));
      }
      let Some((doc, said)) = doc else {
        return Ok(Saved::Unchanged(current.meta));
      };
      transaction.execute(
        "UPDATE notes SET title = ?3, doc = ?4, version = ?5, changed_at = ?6 WHERE owner = ?1 AND id = ?2",
        params![owner, id, said.title, doc, current.meta.version + 1, at],
      )?;
      write_derived(&transaction, owner, id, said)?;
      transaction.commit()?;
      let row = found(connection, owner, id)?.expect("the row stands after the save");
      Ok(Saved::Saved(row.meta))
    })
  }

  /// A live note's icon set, or cleared where `icon` is empty; the version and the moment changed stand.
  pub fn set_icon(&self, owner: &str, id: &str, icon: &str) -> Result<Written, String> {
    self.with(|connection| {
      let Some(current) = found(connection, owner, id)? else {
        return Ok(Written::Missing);
      };
      if current.meta.deleted_at.is_some() {
        return Ok(Written::Trashed);
      }
      connection
        .execute("UPDATE notes SET icon = ?3 WHERE owner = ?1 AND id = ?2", params![owner, id, icon])?;
      Ok(Written::Done(NoteMeta {
        icon: icon.to_owned(),
        ..current.meta
      }))
    })
  }

  /// A live note moved to the trash. Answers the note as it stands after, or none where none lives.
  pub fn trash(&self, owner: &str, id: &str, at: i64) -> Result<Option<NoteMeta>, String> {
    self.with(|connection| {
      connection.execute(
        "UPDATE notes SET deleted_at = ?3 WHERE owner = ?1 AND id = ?2 AND deleted_at IS NULL",
        params![owner, id, at],
      )?;
      let meta = found(connection, owner, id)?.map(|row| row.meta);
      Ok(meta.filter(|meta| meta.deleted_at.is_some()))
    })
  }

  /// A trashed note deleted for good, with its images, its link, its members, its search row, every bookmark
  /// of it and every record of opening it. Answers whether a trashed row stood and went.
  pub fn purge(&self, owner: &str, id: &str) -> Result<bool, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let changed = transaction.execute(
        "DELETE FROM notes WHERE owner = ?1 AND id = ?2 AND deleted_at IS NOT NULL",
        params![owner, id],
      )?;
      if changed == 1 {
        for table in BESIDE_A_NOTE {
          transaction
            .execute(&format!("DELETE FROM {table} WHERE owner = ?1 AND note = ?2"), params![owner, id])?;
        }
      }
      transaction.commit()?;
      Ok(changed == 1)
    })
  }

  /// A new note of `owner`'s own at `id` holding `doc`, the copy of `source_owner`'s live note `source` the
  /// caller made of its document, with what `doc` says, and the source's images and icon.
  #[allow(clippy::too_many_arguments)]
  pub fn duplicate(
    &self,
    source_owner: &str,
    source: &str,
    owner: &str,
    id: &str,
    doc: &[u8],
    said: &Derived,
    at: i64,
  ) -> Result<Copied, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let Some(original) =
        found(&transaction, source_owner, source)?.filter(|row| row.meta.deleted_at.is_none())
      else {
        return Ok(Copied::Missing);
      };
      if found(&transaction, owner, id)?.is_some() {
        return Ok(Copied::Taken);
      }
      // A copy of the account's own note stands in the source's folder; a copy of another's, in none.
      let folder = if source_owner == owner { original.meta.folder.clone() } else { None };
      transaction.execute(
        "INSERT INTO notes (owner, id, title, doc, version, created_at, changed_at, deleted_at, icon, folder) \
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, NULL, ?6, ?7)",
        params![owner, id, said.title, doc, at, original.meta.icon, folder],
      )?;
      transaction.execute(
        "INSERT INTO blobs (owner, note, id, mime, bytes, created_at) \
         SELECT ?1, ?2, id, mime, bytes, ?3 FROM blobs WHERE owner = ?4 AND note = ?5",
        params![owner, id, at, source_owner, source],
      )?;
      write_derived(&transaction, owner, id, said)?;
      transaction.commit()?;
      let row = found(connection, owner, id)?.expect("the copy stands after the insert");
      Ok(Copied::Made(row.meta))
    })
  }

  /// One image stored with a note. An id already held keeps the bytes it was first given.
  pub fn put_blob(
    &self,
    owner: &str,
    note: &str,
    id: &str,
    mime: &str,
    bytes: &[u8],
    at: i64,
  ) -> Result<(), String> {
    self.with(|connection| {
      connection.execute(
        "INSERT INTO blobs (owner, note, id, mime, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT (owner, note, id) DO NOTHING",
        params![owner, note, id, mime, bytes, at],
      )?;
      Ok(())
    })
  }

  /// One account's image, by its note and id, wherever the note stands.
  pub fn blob(&self, owner: &str, note: &str, id: &str) -> Result<Option<(String, Vec<u8>)>, String> {
    self.with(|connection| {
      connection
        .prepare_cached("SELECT mime, bytes FROM blobs WHERE owner = ?1 AND note = ?2 AND id = ?3")?
        .query_row(params![owner, note, id], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()
    })
  }

  /// The live notes other accounts share with `member` in `order`, as one page, each with the access the
  /// share gives.
  pub fn list_shared(
    &self,
    member: &str,
    order: ListOrder,
    after: Option<&ListCursor>,
    limit: i64,
  ) -> Result<(Vec<NoteMeta>, bool), String> {
    self.with(|connection| {
      let mut given: Vec<Box<dyn ToSql>> = vec![Box::new(member.to_owned())];
      let walked = walked(order, after, true, &mut given);
      given.push(Box::new(limit + 1));
      let sql = format!(
        "SELECT {META}, m.permission FROM members m JOIN notes n ON n.owner = m.owner AND n.id = m.note \
         WHERE m.member = ?1 AND n.deleted_at IS NULL {walked} ORDER BY {} LIMIT ?{}",
        ordered(order, true),
        given.len()
      );
      let mut statement = connection.prepare(&sql)?;
      let metas = statement
        .query_map(params_from_iter(given.iter()), held_meta)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
      Ok(paged(metas, limit))
    })
  }

  /// The permission `member` holds of `owner`'s note, where the note lives and is shared with them.
  pub fn permission(&self, owner: &str, note: &str, member: &str) -> Result<Option<Permission>, String> {
    self.with(|connection| {
      connection
        .prepare_cached(
          "SELECT m.permission FROM members m JOIN notes n ON n.owner = m.owner AND n.id = m.note \
           WHERE m.owner = ?1 AND m.note = ?2 AND m.member = ?3 AND n.deleted_at IS NULL",
        )?
        .query_row(params![owner, note, member], |row| row.get::<_, String>(0))
        .optional()
        .map(|word| word.as_deref().map(Permission::of_word))
    })
  }

  /// The account's folders, by name without regard to case, then by id.
  pub fn folders(&self, owner: &str) -> Result<Vec<Folder>, String> {
    self.with(|connection| folders_of(connection, owner))
  }

  /// A folder made under `parent`, or at the top. Where the account already holds one at `id`, the folder
  /// as it stands.
  pub fn make_folder(
    &self,
    owner: &str,
    id: &str,
    name: &str,
    parent: Option<&str>,
    at: i64,
  ) -> Result<Filed<Folder>, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let tree = FolderTree::read(&transaction, owner)?;
      if let Some(standing) = tree.folders.get(id) {
        return Ok(Filed::Done(standing.clone(), false));
      }
      if let Some(parent) = parent {
        if !tree.folders.contains_key(parent) {
          return Ok(Filed::NoFolder);
        }
        if tree.level(parent) + 1 > FOLDER_LEVELS {
          return Ok(Filed::TooDeep);
        }
      }
      transaction.execute(
        "INSERT INTO folders (owner, id, parent, name, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![owner, id, parent, name, at],
      )?;
      transaction.commit()?;
      Ok(Filed::Done(
        Folder {
          id: id.to_owned(),
          parent: parent.map(str::to_owned),
          name: name.to_owned(),
          created_at: at,
        },
        true,
      ))
    })
  }

  /// A folder renamed where `name` is given, and moved under the folder `parent` names where it is given —
  /// to the top for none.
  pub fn change_folder(
    &self,
    owner: &str,
    id: &str,
    name: Option<&str>,
    parent: Option<Option<&str>>,
  ) -> Result<Filed<Folder>, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let tree = FolderTree::read(&transaction, owner)?;
      let Some(standing) = tree.folders.get(id).cloned() else {
        return Ok(Filed::Missing);
      };
      let parent = match parent {
        None => standing.parent.clone(),
        Some(None) => None,
        Some(Some(parent)) => {
          if !tree.folders.contains_key(parent) {
            return Ok(Filed::NoFolder);
          }
          if tree.holds(id, parent) {
            return Ok(Filed::Cycle);
          }
          if tree.level(parent) + tree.height(id) > FOLDER_LEVELS {
            return Ok(Filed::TooDeep);
          }
          Some(parent.to_owned())
        }
      };
      let name = name.unwrap_or(&standing.name).to_owned();
      transaction.execute(
        "UPDATE folders SET name = ?3, parent = ?4 WHERE owner = ?1 AND id = ?2",
        params![owner, id, name, parent],
      )?;
      transaction.commit()?;
      Ok(Filed::Done(
        Folder {
          name,
          parent,
          ..standing
        },
        false,
      ))
    })
  }

  /// A folder deleted: its notes, live and trashed, and the folders it holds move up into the folder it
  /// stood in, or to the top, and its bookmarks go. Answers whether it stood.
  pub fn delete_folder(&self, owner: &str, id: &str) -> Result<bool, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let Some(parent) = transaction
        .prepare_cached("SELECT parent FROM folders WHERE owner = ?1 AND id = ?2")?
        .query_row(params![owner, id], |row| row.get::<_, Option<String>>(0))
        .optional()?
      else {
        return Ok(false);
      };
      transaction.execute(
        "UPDATE notes SET folder = ?3 WHERE owner = ?1 AND folder = ?2",
        params![owner, id, parent],
      )?;
      transaction.execute(
        "UPDATE folders SET parent = ?3 WHERE owner = ?1 AND parent = ?2",
        params![owner, id, parent],
      )?;
      transaction.execute(
        "DELETE FROM bookmarks WHERE account = ?1 AND kind = 'folder' AND folder = ?2",
        params![owner, id],
      )?;
      transaction.execute("DELETE FROM folders WHERE owner = ?1 AND id = ?2", params![owner, id])?;
      transaction.commit()?;
      Ok(true)
    })
  }

  /// One of the account's notes, live or trashed, moved into `folder`, or into none; nothing else of it is
  /// written.
  pub fn file_note(&self, owner: &str, id: &str, folder: Option<&str>) -> Result<Filed<NoteMeta>, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let Some(current) = found(&transaction, owner, id)? else {
        return Ok(Filed::Missing);
      };
      if let Some(folder) = folder
        && !FolderTree::read(&transaction, owner)?.folders.contains_key(folder)
      {
        return Ok(Filed::NoFolder);
      }
      transaction
        .execute("UPDATE notes SET folder = ?3 WHERE owner = ?1 AND id = ?2", params![owner, id, folder])?;
      transaction.commit()?;
      Ok(Filed::Done(
        NoteMeta {
          folder: folder.map(str::to_owned),
          ..current.meta
        },
        false,
      ))
    })
  }

  /// Whether the account holds a folder at `id`.
  pub fn has_folder(&self, owner: &str, id: &str) -> Result<bool, String> {
    self.with(|connection| {
      connection
        .prepare_cached("SELECT 1 FROM folders WHERE owner = ?1 AND id = ?2")?
        .query_row(params![owner, id], |_| Ok(()))
        .optional()
        .map(|found| found.is_some())
    })
  }

  /// A bookmark of `account`'s made, its target named by the fields its kind names, the others empty; where
  /// the account already holds one of the same target, that one stands. Answers its id and whether it was
  /// made now.
  #[allow(clippy::too_many_arguments)]
  pub fn add_bookmark(
    &self,
    account: &str,
    kind: BookmarkKind,
    owner: &str,
    note: &str,
    folder: &str,
    block: &str,
    quote: &str,
    at: i64,
  ) -> Result<(String, bool), String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let made = transaction.execute(
        "INSERT INTO bookmarks (account, id, kind, owner, note, folder, block, quote, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT DO NOTHING",
        params![account, fresh_id(), kind.word(), owner, note, folder, block, quote, at],
      )?;
      let id = transaction.query_row(
        "SELECT id FROM bookmarks WHERE account = ?1 AND kind = ?2 AND owner = ?3 AND note = ?4 \
         AND folder = ?5 AND block = ?6",
        params![account, kind.word(), owner, note, folder, block],
        |row| row.get::<_, String>(0),
      )?;
      transaction.commit()?;
      Ok((id, made == 1))
    })
  }

  /// One of `account`'s bookmarks taken off, whether it stood or not.
  pub fn delete_bookmark(&self, account: &str, id: &str) -> Result<(), String> {
    self.with(|connection| {
      connection.execute("DELETE FROM bookmarks WHERE account = ?1 AND id = ?2", params![account, id])?;
      Ok(())
    })
  }

  /// `account`'s bookmarks, first made first, each with what it names as the account reads it now: a folder
  /// of its own, or a note it reads live, a line's words read from the note's stored document. A bookmark
  /// whose folder or note the account does not read now is left out, its row standing.
  pub fn bookmarks(&self, account: &str) -> Result<Vec<Bookmark>, String> {
    self.with(|connection| {
      let stored = connection
        .prepare_cached(
          "SELECT id, kind, owner, note, folder, block, quote, created_at FROM bookmarks \
           WHERE account = ?1 ORDER BY created_at, id",
        )?
        .query_map(params![account], |row| {
          Ok(StoredBookmark {
            id: row.get(0)?,
            kind: BookmarkKind::of_word(&row.get::<_, String>(1)?),
            owner: row.get(2)?,
            note: row.get(3)?,
            folder: row.get(4)?,
            block: row.get(5)?,
            quote: row.get(6)?,
            created_at: row.get(7)?,
          })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
      let tree = FolderTree::read(connection, account)?;
      let mut answered = Vec::new();
      for one in stored {
        let mut bookmark = Bookmark {
          id: one.id,
          kind: one.kind,
          created_at: one.created_at,
          folder: None,
          note: None,
          block: None,
          quote: None,
          anchored: true,
        };
        match one.kind {
          BookmarkKind::Folder => {
            let Some(folder) = tree.folders.get(&one.folder) else {
              continue;
            };
            bookmark.folder = Some(folder.clone());
          }
          BookmarkKind::Note | BookmarkKind::Line => {
            let Some((row, access)) = read_live(connection, account, &one.owner, &one.note)? else {
              continue;
            };
            if one.kind == BookmarkKind::Line {
              let words = parsed(&row.doc).and_then(|doc| block_words(&doc, &one.block));
              bookmark.anchored = words.is_some();
              bookmark.quote = Some(words.unwrap_or(one.quote));
              bookmark.block = Some(one.block);
            }
            bookmark.note = Some(held_by(row.meta, access));
          }
        }
        answered.push(bookmark);
      }
      Ok(answered)
    })
  }

  /// That `account` opened `owner`'s note `note` at `at`; the account's oldest records past the ones kept
  /// go.
  pub fn record_opened(&self, account: &str, owner: &str, note: &str, at: i64) -> Result<(), String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      transaction.execute(
        "INSERT INTO opened (account, owner, note, opened_at) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT (account, owner, note) DO UPDATE SET opened_at = excluded.opened_at",
        params![account, owner, note, at],
      )?;
      transaction.execute(
        "DELETE FROM opened WHERE account = ?1 AND rowid NOT IN \
         (SELECT rowid FROM opened WHERE account = ?1 ORDER BY opened_at DESC LIMIT ?2)",
        params![account, OPENED_KEPT],
      )?;
      transaction.commit()
    })
  }

  /// The notes `account` opened and reads live, newest opened first, at most `limit`, each with the moment.
  pub fn recent(&self, account: &str, limit: i64) -> Result<Vec<(NoteMeta, i64)>, String> {
    self.with(|connection| {
      let sql = format!(
        "SELECT {META}, {ACCESS}, o.opened_at FROM opened o JOIN notes n ON n.owner = o.owner AND n.id = o.note \
         LEFT JOIN members m ON m.owner = n.owner AND m.note = n.id AND m.member = ?1 \
         WHERE o.account = ?1 AND {READ_LIVE} ORDER BY o.opened_at DESC, o.owner, o.note LIMIT ?2"
      );
      connection
        .prepare(&sql)?
        .query_map(params![account, limit], |row| Ok((held_meta(row)?, row.get(META_COLUMNS + 1)?)))?
        .collect()
    })
  }

  /// The notes a search finds, as one page, with whether anything stands past it. The access clause is
  /// laid on the notes and never on the index: the index decides only what matches.
  pub fn search(&self, search: &Search) -> Result<(Vec<Found>, bool), String> {
    self.with(|connection| {
      let mut given: Vec<Box<dyn ToSql>> = vec![Box::new(search.account.clone())];
      let mut views = Vec::new();
      if search.views.mine {
        views.push("(n.owner = ?1 AND n.deleted_at IS NULL)");
      }
      if search.views.shared {
        views.push("(n.owner <> ?1 AND n.deleted_at IS NULL AND m.member IS NOT NULL)");
      }
      if search.views.trash {
        views.push("(n.owner = ?1 AND n.deleted_at IS NOT NULL)");
      }
      let views = if views.is_empty() { "0".to_owned() } else { views.join(" OR ") };
      let mut clauses = vec![format!("({views})")];
      let indexed = search.index_query.is_some();
      if let Some(query) = &search.index_query {
        given.push(Box::new(query.clone()));
        clauses.push(format!("texts_index MATCH ?{}", given.len()));
      }
      // A short term stands in the title alone where nothing else is searched for, else in either.
      let titles_alone = search.title_only || !indexed;
      for term in &search.short_terms {
        given.push(Box::new(term.clone()));
        let at = given.len();
        clauses.push(if titles_alone {
          format!("instr(lower(t.title), lower(?{at})) > 0")
        } else {
          format!("(instr(lower(t.title), lower(?{at})) > 0 OR instr(lower(t.body), lower(?{at})) > 0)")
        });
      }
      if let Some(since) = search.since {
        given.push(Box::new(since));
        clauses.push(format!("n.changed_at >= ?{}", given.len()));
      }
      let order = match search.order {
        SearchOrder::Best if indexed => {
          given.push(Box::new(search.recent_since));
          format!(
            "bm25(texts_index, 10.0, 1.0) * (CASE WHEN n.changed_at >= ?{} THEN 2.0 ELSE 1.0 END), \
             n.changed_at DESC, n.owner, n.id",
            given.len()
          )
        }
        SearchOrder::Best | SearchOrder::Changed => "n.changed_at DESC, n.owner, n.id".to_owned(),
        SearchOrder::Created => "n.created_at DESC, n.owner, n.id".to_owned(),
      };
      given.push(Box::new(search.limit + 1));
      let limit_at = given.len();
      given.push(Box::new(search.offset));
      let offset_at = given.len();
      let index = if indexed { "JOIN texts_index ON texts_index.rowid = t.row" } else { "" };
      let sql = format!(
        "SELECT {META}, {ACCESS}, t.title, t.body FROM notes n \
         JOIN texts t ON t.owner = n.owner AND t.note = n.id {index} \
         LEFT JOIN members m ON m.owner = n.owner AND m.note = n.id AND m.member = ?1 \
         WHERE {} ORDER BY {order} LIMIT ?{limit_at} OFFSET ?{offset_at}",
        clauses.join(" AND ")
      );
      let mut statement = connection.prepare(&sql)?;
      let found = statement
        .query_map(params_from_iter(given.iter()), |row| {
          Ok(Found {
            meta: held_meta(row)?,
            title: row.get(META_COLUMNS + 1)?,
            body: row.get(META_COLUMNS + 2)?,
          })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
      Ok(paged(found, search.limit))
    })
  }

  /// Who the note is shared with, oldest share first.
  pub fn members(&self, owner: &str, note: &str) -> Result<Vec<Member>, String> {
    self.with(|connection| members_in(connection, owner, note))
  }

  /// The note shared with each of `users` at `permission`; a member already standing keeps the moment
  /// they were shared with and takes the permission. Answers the members as they now stand.
  pub fn share(
    &self,
    owner: &str,
    note: &str,
    users: &[String],
    permission: Permission,
    at: i64,
  ) -> Result<Vec<Member>, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      for user in users {
        transaction.execute(
          "INSERT INTO members (owner, note, member, permission, created_at) VALUES (?1, ?2, ?3, ?4, ?5) \
           ON CONFLICT (owner, note, member) DO UPDATE SET permission = excluded.permission",
          params![owner, note, user, permission.word(), at],
        )?;
      }
      transaction.commit()?;
      members_in(connection, owner, note)
    })
  }

  /// One member's permission changed; none where the note is not shared with that key.
  pub fn change_member(
    &self,
    owner: &str,
    note: &str,
    member: &str,
    permission: Permission,
  ) -> Result<Option<Member>, String> {
    self.with(|connection| {
      connection.execute(
        "UPDATE members SET permission = ?4 WHERE owner = ?1 AND note = ?2 AND member = ?3",
        params![owner, note, member, permission.word()],
      )?;
      Ok(members_in(connection, owner, note)?.into_iter().find(|one| one.user == member))
    })
  }

  /// One member taken off. Answers whether they stood.
  pub fn unshare(&self, owner: &str, note: &str, member: &str) -> Result<bool, String> {
    self.with(|connection| {
      let removed = connection.execute(
        "DELETE FROM members WHERE owner = ?1 AND note = ?2 AND member = ?3",
        params![owner, note, member],
      )?;
      Ok(removed == 1)
    })
  }

  /// The note's live link at `now`.
  pub fn link(&self, owner: &str, note: &str, now: i64) -> Result<Option<Link>, String> {
    self.with(|connection| live_link(connection, owner, note, now))
  }

  /// A link made for the note under `token`, or the live one that already stands. Answers the link and
  /// whether it was made now.
  pub fn make_link(
    &self,
    owner: &str,
    note: &str,
    token: &str,
    expires_at: Option<i64>,
    now: i64,
  ) -> Result<(Link, bool), String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      if let Some(standing) = live_link(&transaction, owner, note, now)? {
        return Ok((standing, false));
      }
      transaction.execute(
        "INSERT INTO links (token, owner, note, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![token, owner, note, now, expires_at],
      )?;
      transaction.commit()?;
      Ok((
        Link {
          token: token.to_owned(),
          note_id: note.to_owned(),
          created_at: now,
          expires_at,
        },
        true,
      ))
    })
  }

  /// The note's link ended. Answers whether one stood.
  pub fn end_link(&self, owner: &str, note: &str) -> Result<bool, String> {
    self.with(|connection| {
      let ended =
        connection.execute("DELETE FROM links WHERE owner = ?1 AND note = ?2", params![owner, note])?;
      Ok(ended == 1)
    })
  }

  /// The live note a live link's token opens at `now`, with the link's end.
  pub fn opened(&self, token: &str, now: i64) -> Result<Option<(Row, Option<i64>)>, String> {
    self.with(|connection| {
      let sql = format!(
        "SELECT {META}, n.doc, l.expires_at FROM links l JOIN notes n ON n.owner = l.owner AND n.id = l.note \
         WHERE l.token = ?1 AND n.deleted_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?2)"
      );
      connection
        .prepare_cached(&sql)?
        .query_row(params![token, now], |row| Ok((row_of(row)?, row.get(META_COLUMNS + 1)?)))
        .optional()
    })
  }

  /// The notes `account` reads live whose documents link to `owner`'s note `note`, newest changed first,
  /// the note itself left out.
  pub fn backlinks(&self, account: &str, owner: &str, note: &str) -> Result<Vec<NoteMeta>, String> {
    self.with(|connection| {
      let sql = format!(
        "SELECT {META}, {ACCESS} FROM note_links l JOIN notes n ON n.owner = l.owner AND n.id = l.note \
         LEFT JOIN members m ON m.owner = n.owner AND m.note = n.id AND m.member = ?1 \
         WHERE l.to_owner = ?2 AND l.to_note = ?3 AND NOT (n.owner = ?2 AND n.id = ?3) AND {READ_LIVE} \
         ORDER BY n.changed_at DESC, n.owner, n.id"
      );
      connection.prepare(&sql)?.query_map(params![account, owner, note], held_meta)?.collect()
    })
  }

  /// The note's threads, oldest first, each with its comments oldest first; `anchored` marks the ones the
  /// note's document carries a mark of.
  pub fn threads(
    &self,
    owner: &str,
    note: &str,
    anchored: &dyn Fn(&str) -> bool,
  ) -> Result<Vec<Thread>, String> {
    self.with(|connection| {
      let mut threads = connection
        .prepare_cached(
          "SELECT id, quote, author, created_at, resolved_at, resolved_by FROM threads \
           WHERE owner = ?1 AND note = ?2 ORDER BY created_at, id",
        )?
        .query_map(params![owner, note], thread_of)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
      let mut statement = connection.prepare_cached(
        "SELECT thread, id, author, body, created_at FROM comments WHERE owner = ?1 AND note = ?2 \
         ORDER BY created_at, id",
      )?;
      let comments = statement
        .query_map(params![owner, note], |row| Ok((row.get::<_, String>(0)?, comment_of(row, 1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
      for thread in &mut threads {
        thread.anchored = anchored(&thread.id);
        thread.comments = comments
          .iter()
          .filter(|(of, _)| *of == thread.id)
          .map(|(_, comment)| comment.clone())
          .collect();
      }
      Ok(threads)
    })
  }

  /// One thread of the note with its comments, where it stands.
  pub fn thread(&self, owner: &str, note: &str, id: &str) -> Result<Option<Thread>, String> {
    self.with(|connection| thread_in(connection, owner, note, id))
  }

  /// A thread started on the note with its first comment; where one stands at `id`, that thread as it
  /// stands. Answers the thread and whether it was made now.
  #[allow(clippy::too_many_arguments)]
  pub fn start_thread(
    &self,
    owner: &str,
    note: &str,
    id: &str,
    quote: &str,
    author: &str,
    body: &str,
    at: i64,
  ) -> Result<(Thread, bool), String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let made = transaction.execute(
        "INSERT INTO threads (owner, note, id, quote, author, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT (owner, note, id) DO NOTHING",
        params![owner, note, id, quote, author, at],
      )? == 1;
      if made {
        transaction.execute(
          "INSERT INTO comments (owner, note, thread, id, author, body, created_at) \
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
          params![owner, note, id, fresh_id(), author, body, at],
        )?;
      }
      transaction.commit()?;
      let thread = thread_in(connection, owner, note, id)?.expect("the thread stands after the insert");
      Ok((thread, made))
    })
  }

  /// A reply under a thread of the note; none where the thread does not stand.
  pub fn reply(
    &self,
    owner: &str,
    note: &str,
    thread: &str,
    author: &str,
    body: &str,
    at: i64,
  ) -> Result<Option<Comment>, String> {
    self.with(|connection| {
      if thread_in(connection, owner, note, thread)?.is_none() {
        return Ok(None);
      }
      let comment = Comment {
        id: fresh_id(),
        author: author.to_owned(),
        body: body.to_owned(),
        created_at: at,
        mine: true,
      };
      connection.execute(
        "INSERT INTO comments (owner, note, thread, id, author, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![owner, note, thread, comment.id, author, body, at],
      )?;
      Ok(Some(comment))
    })
  }

  /// A thread resolved by `by` at `at`, or reopened; none where it does not stand.
  pub fn resolve(
    &self,
    owner: &str,
    note: &str,
    thread: &str,
    resolved: bool,
    by: &str,
    at: i64,
  ) -> Result<Option<Thread>, String> {
    self.with(|connection| {
      let (moment, who) = if resolved { (Some(at), Some(by)) } else { (None, None) };
      connection.execute(
        "UPDATE threads SET resolved_at = ?4, resolved_by = ?5 WHERE owner = ?1 AND note = ?2 AND id = ?3",
        params![owner, note, thread, moment, who],
      )?;
      thread_in(connection, owner, note, thread)
    })
  }

  /// A thread deleted whole with its comments. Answers whether it stood.
  pub fn delete_thread(&self, owner: &str, note: &str, thread: &str) -> Result<bool, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let gone = transaction.execute(
        "DELETE FROM threads WHERE owner = ?1 AND note = ?2 AND id = ?3",
        params![owner, note, thread],
      )?;
      transaction.execute(
        "DELETE FROM comments WHERE owner = ?1 AND note = ?2 AND thread = ?3",
        params![owner, note, thread],
      )?;
      transaction.commit()?;
      Ok(gone == 1)
    })
  }

  /// One comment of a thread deleted, and the thread with it where it was the last. Answers whether it
  /// stood.
  pub fn delete_comment(
    &self,
    owner: &str,
    note: &str,
    thread: &str,
    comment: &str,
  ) -> Result<bool, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let gone = transaction.execute(
        "DELETE FROM comments WHERE owner = ?1 AND note = ?2 AND thread = ?3 AND id = ?4",
        params![owner, note, thread, comment],
      )?;
      transaction.execute(
        "DELETE FROM threads WHERE owner = ?1 AND note = ?2 AND id = ?3 AND NOT EXISTS \
         (SELECT 1 FROM comments c WHERE c.owner = ?1 AND c.note = ?2 AND c.thread = ?3)",
        params![owner, note, thread],
      )?;
      transaction.commit()?;
      Ok(gone == 1)
    })
  }
}

/// The store brought up to this version, in one transaction: every table, index and trigger made where it
/// does not stand, every column added since a table was first made added where it lacks it, every note
/// given its search row, and every note whose search row does not stand for its document given what its
/// document says. Answers how many notes hold a document not of the editor's format, which are left as
/// they stand. Run again, it changes nothing.
fn upgrade(connection: &Connection) -> rusqlite::Result<usize> {
  let transaction = connection.unchecked_transaction()?;
  transaction.execute_batch(SCHEMA)?;
  for (table, column, declared) in ADDED_COLUMNS {
    let standing = transaction
      .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))?
      .query_map([], |row| row.get::<_, String>(0))?
      .collect::<rusqlite::Result<Vec<_>>>()?;
    if !standing.iter().any(|name| name == column) {
      transaction.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {declared}"))?;
    }
  }
  transaction.execute_batch(ON_ADDED_COLUMNS)?;
  let favourites: bool = transaction.query_row(
    "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'pins'",
    [],
    |row| row.get(0),
  )?;
  if favourites {
    transaction.execute_batch(FAVOURITES_AS_BOOKMARKS)?;
  }
  transaction.execute(SEARCH_ROWS, [])?;
  let underived = transaction
    .prepare(
      "SELECT n.owner, n.id, n.doc FROM notes n JOIN texts t ON t.owner = n.owner AND t.note = n.id \
       WHERE t.indexed = 0",
    )?
    .query_map([], |row| {
      Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Vec<u8>>(2)?))
    })?
    .collect::<rusqlite::Result<Vec<_>>>()?;
  for (owner, id, bytes) in underived {
    if let Some(doc) = parsed(&bytes) {
      let said = derived(&doc);
      transaction.execute(
        "UPDATE notes SET title = ?3 WHERE owner = ?1 AND id = ?2",
        params![owner, id, said.title],
      )?;
      write_derived(&transaction, &owner, &id, &said)?;
    }
  }
  let foreign = transaction
    .prepare("SELECT doc FROM notes")?
    .query_map([], |row| row.get::<_, Vec<u8>>(0))?
    .collect::<rusqlite::Result<Vec<_>>>()?
    .iter()
    .filter(|bytes| parsed(bytes).is_none())
    .count();
  transaction.commit()?;
  Ok(foreign)
}

/// What a note's document says, written beside it: its search row holding its title and text, standing
/// for the document, and its links in place of the ones it held.
fn write_derived(connection: &Connection, owner: &str, note: &str, said: &Derived) -> rusqlite::Result<()> {
  connection.execute(
    "INSERT INTO texts (owner, note, title, body, indexed) VALUES (?1, ?2, ?3, ?4, 1) \
     ON CONFLICT (owner, note) DO UPDATE SET title = excluded.title, body = excluded.body, indexed = 1 \
     WHERE texts.title <> excluded.title OR texts.body <> excluded.body OR texts.indexed <> 1",
    params![owner, note, said.title, said.text],
  )?;
  connection.execute("DELETE FROM note_links WHERE owner = ?1 AND note = ?2", params![owner, note])?;
  for (to_owner, to_note) in &said.links {
    connection.execute(
      "INSERT INTO note_links (owner, note, to_owner, to_note) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING",
      params![owner, note, to_owner, to_note],
    )?;
  }
  Ok(())
}

/// The order a list stands in, the note standing as `n`; the shared view adds the owner to part notes of
/// one id.
fn ordered(order: ListOrder, shared: bool) -> String {
  let owner_down = if shared { ", n.owner DESC" } else { "" };
  let owner_up = if shared { ", n.owner" } else { "" };
  match order {
    ListOrder::Changed => format!("n.changed_at DESC, n.id DESC{owner_down}"),
    ListOrder::Created => format!("n.created_at DESC, n.id DESC{owner_down}"),
    ListOrder::Title => format!("(n.title = '') ASC, n.title COLLATE NOCASE ASC, n.id ASC{owner_up}"),
  }
}

/// The clause that starts a list after `after` in `order`, its values pushed onto `given`; none where the
/// list starts at its head.
fn walked(
  order: ListOrder,
  after: Option<&ListCursor>,
  shared: bool,
  given: &mut Vec<Box<dyn ToSql>>,
) -> String {
  let Some(after) = after else {
    return String::new();
  };
  let first = given.len() + 1;
  let owner = |given: &mut Vec<Box<dyn ToSql>>| {
    given.push(Box::new(after.owner.clone().unwrap_or_default()));
  };
  match (&after.key, order) {
    (CursorKey::Moment(moment), ListOrder::Changed | ListOrder::Created) => {
      let column = if order == ListOrder::Changed { "n.changed_at" } else { "n.created_at" };
      given.push(Box::new(*moment));
      given.push(Box::new(after.id.clone()));
      if shared {
        owner(given);
        format!("AND ({column}, n.id, n.owner) < (?{first}, ?{}, ?{})", first + 1, first + 2)
      } else {
        format!("AND ({column}, n.id) < (?{first}, ?{})", first + 1)
      }
    }
    (CursorKey::Title(title), ListOrder::Title) => {
      given.push(Box::new(title.is_empty()));
      given.push(Box::new(title.clone()));
      given.push(Box::new(after.id.clone()));
      if shared {
        owner(given);
        format!(
          "AND ((n.title = ''), n.title COLLATE NOCASE, n.id, n.owner) > (?{first}, ?{}, ?{}, ?{})",
          first + 1,
          first + 2,
          first + 3
        )
      } else {
        format!(
          "AND ((n.title = ''), n.title COLLATE NOCASE, n.id) > (?{first}, ?{}, ?{})",
          first + 1,
          first + 2
        )
      }
    }
    // A cursor read for another order walks nothing; the route reads each cursor for its own order.
    _ => String::new(),
  }
}

/// A page of rows read one past `limit`: the rows and whether anything stands past them.
fn paged<T>(mut rows: Vec<T>, limit: i64) -> (Vec<T>, bool) {
  let more = rows.len() > limit as usize;
  rows.truncate(limit as usize);
  (rows, more)
}

/// The note at an id, document and all: one note is at most the cap, so reads carry it.
fn found(connection: &Connection, owner: &str, id: &str) -> rusqlite::Result<Option<Row>> {
  connection
    .prepare_cached(&format!("SELECT {META}, n.doc FROM notes n WHERE n.owner = ?1 AND n.id = ?2"))?
    .query_row(params![owner, id], row_of)
    .optional()
}

/// A note row read with its metadata first and its document after it.
fn row_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
  Ok(Row {
    meta: meta_of(row)?,
    doc: row.get(META_COLUMNS)?,
  })
}

/// A note's metadata read from a row whose first columns are `META`; the owner's own access.
fn meta_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteMeta> {
  Ok(NoteMeta {
    id: row.get(0)?,
    owner: row.get(1)?,
    title: row.get(2)?,
    version: row.get(3)?,
    created_at: row.get(4)?,
    changed_at: row.get(5)?,
    size: row.get(6)?,
    deleted_at: row.get(7)?,
    access: Access::Owner,
    icon: row.get(8)?,
    folder: row.get(9)?,
  })
}

/// A note's metadata read from a row of `META` and, after it, the word of what the caller holds: `owner`,
/// or a member's permission.
fn held_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteMeta> {
  let word: String = row.get(META_COLUMNS)?;
  let access = if word == "owner" { Access::Owner } else { Permission::of_word(&word).access() };
  Ok(held_by(meta_of(row)?, access))
}

/// A note's metadata as a caller holding `access` reads it: a member is told nothing of the owner's folders.
pub fn held_by(meta: NoteMeta, access: Access) -> NoteMeta {
  let folder = if access == Access::Owner { meta.folder } else { None };
  NoteMeta {
    access,
    folder,
    ..meta
  }
}

/// `owner`'s note `note` with what `account` holds of it, where the account reads it live: its own, or one
/// shared with it.
fn read_live(
  connection: &Connection,
  account: &str,
  owner: &str,
  note: &str,
) -> rusqlite::Result<Option<(Row, Access)>> {
  let Some(row) = found(connection, owner, note)?.filter(|row| row.meta.deleted_at.is_none()) else {
    return Ok(None);
  };
  if owner == account {
    return Ok(Some((row, Access::Owner)));
  }
  let permission = connection
    .prepare_cached("SELECT permission FROM members WHERE owner = ?1 AND note = ?2 AND member = ?3")?
    .query_row(params![owner, note, account], |row| row.get::<_, String>(0))
    .optional()?;
  Ok(permission.map(|word| (row, Permission::of_word(&word).access())))
}

/// A bookmark as its row holds it, the fields its kind does not name empty.
struct StoredBookmark {
  id: String,
  kind: BookmarkKind,
  owner: String,
  note: String,
  folder: String,
  block: String,
  quote: String,
  created_at: i64,
}

/// One account's folders, read whole: few enough that a move is checked against all of them.
struct FolderTree {
  folders: HashMap<String, Folder>,
}

impl FolderTree {
  fn read(connection: &Connection, owner: &str) -> rusqlite::Result<Self> {
    let folders = folders_of(connection, owner)?
      .into_iter()
      .map(|folder| (folder.id.clone(), folder))
      .collect();
    Ok(Self { folders })
  }

  /// The level a folder stands at, 1 at the top; a parent that does not stand ends the walk.
  fn level(&self, id: &str) -> usize {
    let mut level = 0;
    let mut at = Some(id);
    while let Some(id) = at {
      let Some(folder) = self.folders.get(id) else {
        break;
      };
      level += 1;
      if level > self.folders.len() {
        break;
      }
      at = folder.parent.as_deref();
    }
    level
  }

  /// Whether `held` is `folder` itself or stands anywhere inside it.
  fn holds(&self, folder: &str, held: &str) -> bool {
    let mut at = Some(held);
    let mut steps = 0;
    while let Some(id) = at {
      if id == folder {
        return true;
      }
      steps += 1;
      if steps > self.folders.len() {
        return false;
      }
      at = self.folders.get(id).and_then(|one| one.parent.as_deref());
    }
    false
  }

  /// How many levels a folder and the folders inside it take, 1 for one holding none.
  fn height(&self, id: &str) -> usize {
    self
      .folders
      .values()
      .filter(|folder| self.holds(id, &folder.id))
      .map(|folder| self.level(&folder.id))
      .max()
      .map_or(1, |deepest| deepest + 1 - self.level(id))
  }
}

/// The account's folders, by name without regard to case, then by id.
fn folders_of(connection: &Connection, owner: &str) -> rusqlite::Result<Vec<Folder>> {
  connection
    .prepare_cached(
      "SELECT id, parent, name, created_at FROM folders WHERE owner = ?1 ORDER BY name COLLATE NOCASE, id",
    )?
    .query_map(params![owner], |row| {
      Ok(Folder {
        id: row.get(0)?,
        parent: row.get(1)?,
        name: row.get(2)?,
        created_at: row.get(3)?,
      })
    })?
    .collect()
}

/// A member read from a row of id-less columns: the member, the permission word and the moment shared.
fn member_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<Member> {
  Ok(Member {
    user: row.get(0)?,
    permission: Permission::of_word(&row.get::<_, String>(1)?),
    shared_at: row.get(2)?,
  })
}

/// A link read from a row of its token, note, moment made and end.
fn link_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<Link> {
  Ok(Link {
    token: row.get(0)?,
    note_id: row.get(1)?,
    created_at: row.get(2)?,
    expires_at: row.get(3)?,
  })
}

/// Drops the note's link where its end has passed, so a live link is the one row that stands.
fn sweep_link(connection: &Connection, owner: &str, note: &str, now: i64) -> rusqlite::Result<()> {
  connection.execute(
    "DELETE FROM links WHERE owner = ?1 AND note = ?2 AND expires_at IS NOT NULL AND expires_at <= ?3",
    params![owner, note, now],
  )?;
  Ok(())
}

/// The note's live link, its passed one swept first.
fn live_link(connection: &Connection, owner: &str, note: &str, now: i64) -> rusqlite::Result<Option<Link>> {
  sweep_link(connection, owner, note, now)?;
  connection
    .prepare_cached("SELECT token, note, created_at, expires_at FROM links WHERE owner = ?1 AND note = ?2")?
    .query_row(params![owner, note], link_of)
    .optional()
}

fn members_in(connection: &Connection, owner: &str, note: &str) -> rusqlite::Result<Vec<Member>> {
  connection
    .prepare_cached(
      "SELECT member, permission, created_at FROM members WHERE owner = ?1 AND note = ?2 \
       ORDER BY created_at, member",
    )?
    .query_map(params![owner, note], member_of)?
    .collect()
}

/// A thread read from a row of its id, quote, author, moment made and resolution, with no comments yet.
fn thread_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<Thread> {
  Ok(Thread {
    id: row.get(0)?,
    quote: row.get(1)?,
    author: row.get(2)?,
    created_at: row.get(3)?,
    resolved_at: row.get(4)?,
    resolved_by: row.get(5)?,
    anchored: false,
    mine: false,
    comments: Vec::new(),
  })
}

/// A comment read from a row whose columns from `at` are its id, author, words and moment.
fn comment_of(row: &rusqlite::Row<'_>, at: usize) -> rusqlite::Result<Comment> {
  Ok(Comment {
    id: row.get(at)?,
    author: row.get(at + 1)?,
    body: row.get(at + 2)?,
    created_at: row.get(at + 3)?,
    mine: false,
  })
}

/// One thread of a note with its comments, its anchoring left to the caller.
fn thread_in(
  connection: &Connection,
  owner: &str,
  note: &str,
  id: &str,
) -> rusqlite::Result<Option<Thread>> {
  let Some(mut thread) = connection
    .prepare_cached(
      "SELECT id, quote, author, created_at, resolved_at, resolved_by FROM threads \
       WHERE owner = ?1 AND note = ?2 AND id = ?3",
    )?
    .query_row(params![owner, note, id], thread_of)
    .optional()?
  else {
    return Ok(None);
  };
  thread.comments = connection
    .prepare_cached(
      "SELECT id, author, body, created_at FROM comments WHERE owner = ?1 AND note = ?2 AND thread = ?3 \
       ORDER BY created_at, id",
    )?
    .query_map(params![owner, note, id], |row| comment_of(row, 0))?
    .collect::<rusqlite::Result<Vec<_>>>()?;
  Ok(Some(thread))
}
