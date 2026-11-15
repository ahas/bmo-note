//! The unit's own store (`docs/design.md`, 「Storage」): one SQLite file — every note of every account with
//! its document bytes, every note's images, share link and members, every note's search text and the
//! full-text index over it, and each account's pins and record of what it opened. The service's truth
//! stands here; it rebuilds nothing.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::types::ToSql;
use rusqlite::{Connection, OptionalExtension, params, params_from_iter};

use crate::model::{CursorKey, ListCursor};
use crate::wire::{Access, Link, ListOrder, Member, NoteMeta, Permission, SearchOrder};

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
CREATE TABLE IF NOT EXISTS pins (
  account TEXT NOT NULL,
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (account, owner, note)
);
CREATE INDEX IF NOT EXISTS pins_note ON pins (owner, note);
CREATE TABLE IF NOT EXISTS opened (
  account TEXT NOT NULL,
  owner TEXT NOT NULL,
  note TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (account, owner, note)
);
CREATE INDEX IF NOT EXISTS opened_latest ON opened (account, opened_at DESC);
CREATE INDEX IF NOT EXISTS opened_note ON opened (owner, note);
";

/// The columns a table gained after it was first made, each with its declaration, added where an older
/// store's table lacks them (`docs/design.md`, 「Storage」).
const ADDED_COLUMNS: [(&str, &str, &str); 1] = [("notes", "icon", "TEXT NOT NULL DEFAULT ''")];

/// Every note's search row, made where a note has none: its title, and no text.
const SEARCH_ROWS: &str = "INSERT INTO texts (owner, note, title) SELECT owner, id, title FROM notes WHERE true \
  ON CONFLICT (owner, note) DO NOTHING";

/// How many notes an account's record of what it opened keeps.
const OPENED_KEPT: i64 = 100;

/// A note's metadata as every read selects it, the note standing as `n`: id, owner, title, version, the two
/// moments, the document's length, the trash mark, the icon and whether its text is supplied.
const META: &str = "n.id, n.owner, n.title, n.version, n.created_at, n.changed_at, length(n.doc), n.deleted_at, \
  n.icon, EXISTS (SELECT 1 FROM texts x WHERE x.owner = n.owner AND x.note = n.id AND x.indexed = 1)";

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

/// How a write beside the document — a text, an icon — ended.
#[derive(Clone, Debug, PartialEq)]
pub enum Written {
  /// The note as it stands after the write.
  Done(NoteMeta),
  /// The note as it stands, at a version other than the one the write was made for.
  Conflict(NoteMeta),
  /// No note stands at the id, live or trashed.
  Missing,
  /// The note stands in the trash.
  Trashed,
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
    upgrade(&connection).map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(Self {
      connection: Arc::new(Mutex::new(connection)),
    })
  }

  fn with<T>(&self, work: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let connection = self.connection.lock().map_err(|_| "the store's lock is poisoned".to_owned())?;
    work(&connection).map_err(|why| format!("the store: {why}"))
  }

  /// The live (`deleted` false) or trashed (true) notes of one account in `order`, as one page: at most
  /// `limit` rows and whether anything stands past them.
  pub fn list(
    &self,
    owner: &str,
    deleted: bool,
    order: ListOrder,
    after: Option<&ListCursor>,
    limit: i64,
  ) -> Result<(Vec<NoteMeta>, bool), String> {
    self.with(|connection| {
      let live = if deleted { "n.deleted_at IS NOT NULL" } else { "n.deleted_at IS NULL" };
      let mut given: Vec<Box<dyn ToSql>> = vec![Box::new(owner.to_owned())];
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

  /// A note made, with its search row. Answers its metadata and whether the row was made now; where the
  /// account already holds one at `id`, the note as it stands, trashed included.
  pub fn create(
    &self,
    owner: &str,
    id: &str,
    title: &str,
    doc: &[u8],
    at: i64,
  ) -> Result<(NoteMeta, bool), String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let changed = transaction.execute(
        "INSERT INTO notes (owner, id, title, doc, version, created_at, changed_at, deleted_at) \
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, NULL) ON CONFLICT (owner, id) DO NOTHING",
        params![owner, id, title, doc, at],
      )?;
      if changed == 1 {
        transaction.execute(
          "INSERT INTO texts (owner, note, title) VALUES (?1, ?2, ?3) ON CONFLICT (owner, note) DO NOTHING",
          params![owner, id, title],
        )?;
      }
      transaction.commit()?;
      let row = found(connection, owner, id)?.expect("the row stands after the insert");
      Ok((row.meta, changed == 1))
    })
  }

  /// A save of a note: `version` is the version the writer read; a save from behind the stored one
  /// answers the note as it stands. A restore writes no bytes and holds no version. A document saved
  /// carries its plain text, or leaves the note unindexed where it carries none.
  #[allow(clippy::too_many_arguments)]
  pub fn save(
    &self,
    owner: &str,
    id: &str,
    title: Option<&str>,
    doc: Option<&[u8]>,
    text: Option<&str>,
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
      if title.is_none() && doc.is_none() {
        return Ok(Saved::Unchanged(current.meta));
      }
      let title = title.unwrap_or(&current.meta.title).to_owned();
      transaction.execute(
        "UPDATE notes SET title = ?3, doc = COALESCE(?4, doc), version = ?5, changed_at = ?6 \
         WHERE owner = ?1 AND id = ?2",
        params![owner, id, title, doc, current.meta.version + 1, at],
      )?;
      search_row(&transaction, owner, id, &title)?;
      if doc.is_some() {
        transaction.execute(
          "UPDATE texts SET body = ?3, indexed = ?4 WHERE owner = ?1 AND note = ?2",
          params![owner, id, text.unwrap_or(""), text.is_some()],
        )?;
      }
      transaction.commit()?;
      let row = found(connection, owner, id)?.expect("the row stands after the save");
      Ok(Saved::Saved(row.meta))
    })
  }

  /// The plain text of a live note's stored document, written where `version` is the stored one; the
  /// document, the version and the moment changed stand as they stood.
  pub fn set_text(&self, owner: &str, id: &str, version: i64, text: &str) -> Result<Written, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let Some(current) = found(&transaction, owner, id)? else {
        return Ok(Written::Missing);
      };
      if current.meta.deleted_at.is_some() {
        return Ok(Written::Trashed);
      }
      if version != current.meta.version {
        return Ok(Written::Conflict(current.meta));
      }
      search_row(&transaction, owner, id, &current.meta.title)?;
      transaction.execute(
        "UPDATE texts SET body = ?3, indexed = 1 WHERE owner = ?1 AND note = ?2",
        params![owner, id, text],
      )?;
      transaction.commit()?;
      let row = found(connection, owner, id)?.expect("the row stands after the write");
      Ok(Written::Done(row.meta))
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

  /// A trashed note deleted for good, with its images, its link, its members, its search row, every pin of
  /// it and every record of opening it. Answers whether a trashed row stood and went.
  pub fn purge(&self, owner: &str, id: &str) -> Result<bool, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let changed = transaction.execute(
        "DELETE FROM notes WHERE owner = ?1 AND id = ?2 AND deleted_at IS NOT NULL",
        params![owner, id],
      )?;
      if changed == 1 {
        for table in ["blobs", "links", "members", "texts", "pins", "opened"] {
          transaction
            .execute(&format!("DELETE FROM {table} WHERE owner = ?1 AND note = ?2"), params![owner, id])?;
        }
      }
      transaction.commit()?;
      Ok(changed == 1)
    })
  }

  /// A new note of `owner`'s own at `id`, titled `title`, holding the document, the images, the icon and
  /// the text of `source_owner`'s live note `source`.
  pub fn duplicate(
    &self,
    source_owner: &str,
    source: &str,
    owner: &str,
    id: &str,
    title: &str,
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
      transaction.execute(
        "INSERT INTO notes (owner, id, title, doc, version, created_at, changed_at, deleted_at, icon) \
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, NULL, ?6)",
        params![owner, id, title, original.doc, at, original.meta.icon],
      )?;
      transaction.execute(
        "INSERT INTO blobs (owner, note, id, mime, bytes, created_at) \
         SELECT ?1, ?2, id, mime, bytes, ?3 FROM blobs WHERE owner = ?4 AND note = ?5",
        params![owner, id, at, source_owner, source],
      )?;
      transaction.execute(
        "INSERT INTO texts (owner, note, title, body, indexed) \
         SELECT ?1, ?2, ?3, body, indexed FROM texts WHERE owner = ?4 AND note = ?5 \
         ON CONFLICT (owner, note) DO NOTHING",
        params![owner, id, title, source_owner, source],
      )?;
      search_row(&transaction, owner, id, title)?;
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

  /// `owner`'s note `note` pinned for `account`; a pin already standing keeps its place.
  pub fn pin(&self, account: &str, owner: &str, note: &str, at: i64) -> Result<(), String> {
    self.with(|connection| {
      connection.execute(
        "INSERT INTO pins (account, owner, note, pinned_at) VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT (account, owner, note) DO NOTHING",
        params![account, owner, note, at],
      )?;
      Ok(())
    })
  }

  /// `account`'s pin of `owner`'s note `note` taken off, whether it stood or not.
  pub fn unpin(&self, account: &str, owner: &str, note: &str) -> Result<(), String> {
    self.with(|connection| {
      connection.execute(
        "DELETE FROM pins WHERE account = ?1 AND owner = ?2 AND note = ?3",
        params![account, owner, note],
      )?;
      Ok(())
    })
  }

  /// The notes `account` pinned and reads live, first pinned first.
  pub fn pinned(&self, account: &str) -> Result<Vec<NoteMeta>, String> {
    self.with(|connection| {
      let sql = format!(
        "SELECT {META}, {ACCESS} FROM pins p JOIN notes n ON n.owner = p.owner AND n.id = p.note \
         LEFT JOIN members m ON m.owner = n.owner AND m.note = n.id AND m.member = ?1 \
         WHERE p.account = ?1 AND {READ_LIVE} ORDER BY p.pinned_at, p.owner, p.note"
      );
      connection.prepare(&sql)?.query_map(params![account], held_meta)?.collect()
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
}

/// The store brought up to this version, in one transaction: every table, index and trigger made where it
/// does not stand, every column added since a table was first made added where it lacks it, and every note
/// given its search row. Run again, it changes nothing.
fn upgrade(connection: &Connection) -> rusqlite::Result<()> {
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
  transaction.execute(SEARCH_ROWS, [])?;
  transaction.commit()
}

/// A note's search row made where it has none, and its title written there.
fn search_row(connection: &Connection, owner: &str, note: &str, title: &str) -> rusqlite::Result<()> {
  connection.execute(
    "INSERT INTO texts (owner, note, title) VALUES (?1, ?2, ?3) \
     ON CONFLICT (owner, note) DO UPDATE SET title = excluded.title WHERE texts.title <> excluded.title",
    params![owner, note, title],
  )?;
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
    indexed: row.get(9)?,
  })
}

/// A note's metadata read from a row of `META` and, after it, the word of what the caller holds: `owner`,
/// or a member's permission.
fn held_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteMeta> {
  let word: String = row.get(META_COLUMNS)?;
  let access = if word == "owner" { Access::Owner } else { Permission::of_word(&word).access() };
  Ok(NoteMeta {
    access,
    ..meta_of(row)?
  })
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
