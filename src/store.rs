//! The unit's own store (`docs/design.md`, 「Storage」): one SQLite file, one table, every note of every
//! account with its document bytes. The service's truth stands here; it rebuilds nothing.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension, params};

use crate::wire::NoteMeta;

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
  PRIMARY KEY (owner, id)
);
CREATE INDEX IF NOT EXISTS notes_changed ON notes (owner, deleted_at, changed_at DESC, id DESC);
";

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

/// The store, one SQLite file.
#[derive(Clone)]
pub struct Store {
  connection: Arc<Mutex<Connection>>,
}

impl Store {
  /// The store at `path`, its folder and its tables made where they do not stand.
  pub fn open(path: &Path) -> Result<Self, String> {
    if let Some(folder) = path.parent().filter(|folder| !folder.as_os_str().is_empty()) {
      std::fs::create_dir_all(folder).map_err(|why| format!("{}: {why}", folder.display()))?;
    }
    let connection = Connection::open(path).map_err(|why| format!("{}: {why}", path.display()))?;
    connection.pragma_update(None, "journal_mode", "WAL").map_err(|why| why.to_string())?;
    connection.pragma_update(None, "busy_timeout", 5000).map_err(|why| why.to_string())?;
    connection.execute_batch(SCHEMA).map_err(|why| format!("{}: {why}", path.display()))?;
    Ok(Self {
      connection: Arc::new(Mutex::new(connection)),
    })
  }

  fn with<T>(&self, work: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
    let connection = self.connection.lock().map_err(|_| "the store's lock is poisoned".to_owned())?;
    work(&connection).map_err(|why| format!("the store: {why}"))
  }

  /// The live (`deleted` false) or trashed (true) notes of one account, newest changed first, as one
  /// page: at most `limit` rows and whether anything stands past them.
  pub fn list(
    &self,
    owner: &str,
    deleted: bool,
    after: Option<(i64, String)>,
    limit: i64,
  ) -> Result<(Vec<NoteMeta>, bool), String> {
    self.with(|connection| {
      let live = if deleted { "deleted_at IS NOT NULL" } else { "deleted_at IS NULL" };
      let walked = if after.is_some() { "AND (changed_at, id) < (?3, ?4) " } else { "" };
      let sql = format!(
        "SELECT id, title, version, created_at, changed_at, length(doc), deleted_at \
         FROM notes WHERE owner = ?1 AND {live} {walked} \
         ORDER BY changed_at DESC, id DESC LIMIT ?2"
      );
      let mut statement = connection.prepare(&sql)?;
      let mut metas = Vec::new();
      let found = match &after {
        Some((moment, id)) => statement.query_map(params![owner, limit + 1, moment, id], meta_of)?,
        None => statement.query_map(params![owner, limit + 1], meta_of)?,
      };
      for row in found {
        metas.push(row?);
      }
      let more = metas.len() > limit as usize;
      metas.truncate(limit as usize);
      Ok((metas, more))
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

  /// A note made. Answers its metadata and whether the row was made now; where the account already
  /// holds one at `id`, the note as it stands, trashed included.
  pub fn create(
    &self,
    owner: &str,
    id: &str,
    title: &str,
    doc: &[u8],
    at: i64,
  ) -> Result<(NoteMeta, bool), String> {
    self.with(|connection| {
      let changed = connection.execute(
        "INSERT INTO notes (owner, id, title, doc, version, created_at, changed_at, deleted_at) \
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, NULL) ON CONFLICT (owner, id) DO NOTHING",
        params![owner, id, title, doc, at],
      )?;
      let row = found(connection, owner, id)?.expect("the row stands after the insert");
      Ok((row.meta, changed == 1))
    })
  }

  /// A save of a note: `version` is the version the writer read; a save from behind the stored one
  /// answers the note as it stands. A restore writes no bytes and holds no version.
  #[allow(clippy::too_many_arguments)]
  pub fn save(
    &self,
    owner: &str,
    id: &str,
    title: Option<&str>,
    doc: Option<&[u8]>,
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
      let size = doc.map_or(current.doc.len(), <[u8]>::len) as i64;
      transaction.execute(
        "UPDATE notes SET title = ?3, doc = COALESCE(?4, doc), version = ?5, changed_at = ?6 \
         WHERE owner = ?1 AND id = ?2",
        params![owner, id, title, doc, current.meta.version + 1, at],
      )?;
      transaction.commit()?;
      Ok(Saved::Saved(NoteMeta {
        title,
        version: current.meta.version + 1,
        changed_at: at,
        size,
        ..current.meta
      }))
    })
  }

  /// A live note moved to the trash. Answers the note as it stands after, or none where none lives.
  pub fn trash(&self, owner: &str, id: &str, at: i64) -> Result<Option<NoteMeta>, String> {
    self.with(|connection| {
      let moved = connection.execute(
        "UPDATE notes SET deleted_at = ?3 WHERE owner = ?1 AND id = ?2 AND deleted_at IS NULL",
        params![owner, id, at],
      )?;
      let meta = found(connection, owner, id)?.map(|row| row.meta);
      let _ = moved;
      Ok(meta.filter(|meta| meta.deleted_at.is_some()))
    })
  }

  /// A trashed note deleted for good. Answers whether a trashed row stood and went.
  pub fn purge(&self, owner: &str, id: &str) -> Result<bool, String> {
    self.with(|connection| {
      let changed = connection.execute(
        "DELETE FROM notes WHERE owner = ?1 AND id = ?2 AND deleted_at IS NOT NULL",
        params![owner, id],
      )?;
      Ok(changed == 1)
    })
  }
}

/// The note at an id, document and all: one note is at most the cap, so reads carry it.
fn found(connection: &Connection, owner: &str, id: &str) -> rusqlite::Result<Option<Row>> {
  connection
    .prepare_cached(
      "SELECT id, title, version, created_at, changed_at, length(doc), deleted_at, doc \
       FROM notes WHERE owner = ?1 AND id = ?2",
    )?
    .query_row(params![owner, id], |row| {
      Ok(Row {
        meta: NoteMeta {
          id: row.get(0)?,
          title: row.get(1)?,
          version: row.get(2)?,
          created_at: row.get(3)?,
          changed_at: row.get(4)?,
          size: row.get(5)?,
          deleted_at: row.get(6)?,
        },
        doc: row.get(7)?,
      })
    })
    .optional()
}

fn meta_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteMeta> {
  Ok(NoteMeta {
    id: row.get(0)?,
    title: row.get(1)?,
    version: row.get(2)?,
    created_at: row.get(3)?,
    changed_at: row.get(4)?,
    size: row.get(5)?,
    deleted_at: row.get(6)?,
  })
}
