//! The service's wire types (`docs/api.md`): what each route takes and answers, in the platform's format.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A note as the list and the writes answer it, without its document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
  pub id: String,
  /// May be empty; the screen names an empty one by its own word.
  pub title: String,
  /// A whole number from 1, held up on each save.
  pub version: i64,
  pub created_at: i64,
  pub changed_at: i64,
  /// The stored document's size, in bytes.
  pub size: i64,
  /// Epoch ms of the move to the trash; null while the note lives.
  pub deleted_at: Option<i64>,
}

/// A note with its document, base64 (`docs/design.md`, 「What a note is」).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
  #[serde(flatten)]
  pub meta: NoteMeta,
  pub doc: String,
}

/// A note to make.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNote {
  /// 1 to 64 letters, digits, `-` and `_`; one is made where none is given.
  #[serde(default)]
  pub id: Option<String>,
  pub title: String,
  pub doc: String,
}

/// A save of a note: the version it was made from, and the fields it writes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSave {
  /// The version the writer read; a save from behind the stored one is refused.
  pub version: i64,
  #[serde(default)]
  pub title: Option<String>,
  #[serde(default)]
  pub doc: Option<String>,
  /// Moves a trashed note back to life; writes nothing else on a live note.
  #[serde(default)]
  pub restore: Option<bool>,
}

/// The list page a call takes.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesQuery {
  /// Answers the trash instead of the live notes.
  #[serde(default)]
  pub deleted: Option<bool>,
  /// The cursor: `changedAt:id` of the last row of the page before.
  #[serde(default)]
  pub after: Option<String>,
  /// The most rows one page holds, 50 where none is given, at most 200.
  #[serde(default)]
  pub limit: Option<i64>,
  /// The account a service-token call answers for.
  #[serde(default)]
  pub owner: Option<String>,
}

/// A route that names one note.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteQuery {
  /// The account a service-token call acts for.
  #[serde(default)]
  pub owner: Option<String>,
}

/// A cancellation of a note.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteQuery {
  /// Deletes a trashed note for good instead of trashing a live one.
  #[serde(default)]
  pub purge: Option<bool>,
  /// The account a service-token call acts for.
  #[serde(default)]
  pub owner: Option<String>,
}

/// A page of members.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Page<T> {
  pub items: Vec<T>,
  /// Whether anything stands past the last item.
  pub more: bool,
}

/// `GET /health`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Health {
  pub ready: bool,
  /// Null when ready.
  pub reason: Option<String>,
  pub version: String,
}

/// A failure.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WireError {
  /// kebab-case.
  pub code: String,
  /// An English sentence.
  pub error: String,
}

/// One event the service publishes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StreamEvent {
  pub id: i64,
  pub kind: String,
  pub at: i64,
  pub data: Value,
}

/// Which events to read.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsQuery {
  /// The last event number seen.
  #[serde(default)]
  pub after: Option<i64>,
  /// Comma-separated kinds.
  #[serde(default)]
  pub kinds: Option<String>,
  /// The most events a page holds, 50 where none is given, at most 500.
  #[serde(default)]
  pub limit: Option<i64>,
}

/// The data every note event carries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEvent {
  pub note_id: String,
  pub owner: String,
}

/// A role a reader holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
  Administrator,
  Member,
}

/// The console bundle's manifest (bmo-ui's `docs/console-bundles.md`, 「The manifest」).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleManifest {
  pub name: String,
  pub title: String,
  pub icon: String,
  pub screen_path: String,
  pub service_name: String,
  pub bundle: String,
  pub stylesheet: String,
  pub words: String,
  pub api_prefix: String,
  pub role: Role,
  pub owner_key: bool,
  pub events: bool,
  pub websocket: bool,
  pub push_kinds: Vec<String>,
  pub calls: Vec<String>,
  pub relays: Vec<Value>,
  pub share_reads: Vec<String>,
}
