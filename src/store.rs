//! The unit's own store (`docs/design.md`, 「Storage」): one SQLite file, four tables — every note of every
//! account with its document bytes, every note's images with theirs, every note's share link, and every
//! account a note is shared with. The service's truth stands here; it rebuilds nothing.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension, params};

use crate::wire::{Access, Link, Member, NoteMeta, Permission};

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
        "SELECT id, owner, title, version, created_at, changed_at, length(doc), deleted_at \
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

  /// A trashed note deleted for good, its images with it. Answers whether a trashed row stood and went.
  pub fn purge(&self, owner: &str, id: &str) -> Result<bool, String> {
    self.with(|connection| {
      let transaction = connection.unchecked_transaction()?;
      let changed = transaction.execute(
        "DELETE FROM notes WHERE owner = ?1 AND id = ?2 AND deleted_at IS NOT NULL",
        params![owner, id],
      )?;
      if changed == 1 {
        for table in ["blobs", "links", "members"] {
          transaction
            .execute(&format!("DELETE FROM {table} WHERE owner = ?1 AND note = ?2"), params![owner, id])?;
        }
      }
      transaction.commit()?;
      Ok(changed == 1)
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

  /// The live notes other accounts share with `member`, newest changed first, as one page, each with the
  /// access the share gives; `after` is the last row's moment, id and owner.
  pub fn list_shared(
    &self,
    member: &str,
    after: Option<(i64, String, String)>,
    limit: i64,
  ) -> Result<(Vec<NoteMeta>, bool), String> {
    self.with(|connection| {
      let walked = if after.is_some() { "AND (n.changed_at, n.id, n.owner) < (?3, ?4, ?5) " } else { "" };
      let sql = format!(
        "SELECT n.id, n.owner, n.title, n.version, n.created_at, n.changed_at, length(n.doc), n.deleted_at, \
         m.permission FROM members m JOIN notes n ON n.owner = m.owner AND n.id = m.note \
         WHERE m.member = ?1 AND n.deleted_at IS NULL {walked} \
         ORDER BY n.changed_at DESC, n.id DESC, n.owner DESC LIMIT ?2"
      );
      let mut statement = connection.prepare(&sql)?;
      let shared = |row: &rusqlite::Row<'_>| {
        let permission = Permission::of_word(&row.get::<_, String>(8)?);
        Ok(NoteMeta {
          access: permission.access(),
          ..meta_of(row)?
        })
      };
      let found = match &after {
        Some((moment, id, owner)) => statement.query_map(params![member, limit + 1, moment, id, owner], shared)?,
        None => statement.query_map(params![member, limit + 1], shared)?,
      };
      let mut metas = found.collect::<rusqlite::Result<Vec<_>>>()?;
      let more = metas.len() > limit as usize;
      metas.truncate(limit as usize);
      Ok((metas, more))
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
      connection
        .prepare_cached(
          "SELECT n.id, n.owner, n.title, n.version, n.created_at, n.changed_at, length(n.doc), n.deleted_at, \
           n.doc, l.expires_at FROM links l JOIN notes n ON n.owner = l.owner AND n.id = l.note \
           WHERE l.token = ?1 AND n.deleted_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?2)",
        )?
        .query_row(params![token, now], |row| Ok((row_of(row)?, row.get(9)?)))
        .optional()
    })
  }
}

/// The note at an id, document and all: one note is at most the cap, so reads carry it.
fn found(connection: &Connection, owner: &str, id: &str) -> rusqlite::Result<Option<Row>> {
  connection
    .prepare_cached(
      "SELECT id, owner, title, version, created_at, changed_at, length(doc), deleted_at, doc \
       FROM notes WHERE owner = ?1 AND id = ?2",
    )?
    .query_row(params![owner, id], row_of)
    .optional()
}

/// A note row read in the order `found` selects it, document last.
fn row_of(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
  Ok(Row {
    meta: meta_of(row)?,
    doc: row.get(8)?,
  })
}

/// A note's metadata read from a row whose first columns are id, owner, title, version, the two
/// moments, the document's length and the trash mark; the owner's own access.
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
