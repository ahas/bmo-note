//! The service's wire types (`docs/api.md`): what each route takes and answers, in the platform's format.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A note as the list and the writes answer it, without its document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
  pub id: String,
  /// The account key the note belongs to.
  pub owner: String,
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
  /// What the caller holds of the note.
  pub access: Access,
}

/// What a caller holds of a note: the note's own account, or a member's share (`docs/design.md`, 「Who
/// owns a note, and who it is shared with」).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Access {
  Owner,
  Edit,
  Read,
}

impl Access {
  /// Whether the caller may write the note's document and images.
  pub fn writes(self) -> bool {
    matches!(self, Self::Owner | Self::Edit)
  }
}

/// The permission a member is given.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
  Read,
  Edit,
}

impl Permission {
  /// The word the store keeps the permission as.
  pub fn word(self) -> &'static str {
    match self {
      Self::Read => "read",
      Self::Edit => "edit",
    }
  }

  /// The permission a stored word names; anything but `edit` reads as `read`, the narrower one.
  pub fn of_word(word: &str) -> Self {
    if word == "edit" { Self::Edit } else { Self::Read }
  }

  /// What a member holding the permission holds of the note.
  pub fn access(self) -> Access {
    match self {
      Self::Read => Access::Read,
      Self::Edit => Access::Edit,
    }
  }
}

/// A note's share link (`docs/api.md`, 「Sharing」).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
  pub token: String,
  pub note_id: String,
  pub created_at: i64,
  /// Epoch ms the link stops opening; null where it never does.
  pub expires_at: Option<i64>,
}

/// A link to make.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLink {
  /// Epoch ms in the future; none for a link that never ends.
  #[serde(default)]
  pub expires_at: Option<i64>,
}

/// One account a note is shared with.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
  /// The account key.
  pub user: String,
  pub permission: Permission,
  pub shared_at: i64,
}

/// A share with people.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMembers {
  pub users: Vec<String>,
  pub permission: Permission,
}

/// A member's permission changed.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberChange {
  pub permission: Permission,
}

/// The note a link opens, as its share page reads it: nothing of the owner's account.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedNote {
  pub id: String,
  pub title: String,
  pub changed_at: i64,
  pub size: i64,
  pub expires_at: Option<i64>,
  pub doc: String,
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
  /// Answers the live notes other accounts share with the caller.
  #[serde(default)]
  pub shared: Option<bool>,
  /// The cursor: `changedAt:id` of the last row of the page before, `changedAt:id:owner` in the shared view.
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
  /// The account a service-token call acts for; on a console call, the account whose note it reaches.
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
  /// The account a service-token call acts for; on a console call, the account whose note it reaches.
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

/// The data a share's own events carry.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareEvent {
  pub note_id: String,
  pub owner: String,
  pub member: String,
  /// The permission given; none on `note.unshared`.
  #[serde(skip_serializing_if = "Option::is_none", default)]
  pub permission: Option<Permission>,
}
