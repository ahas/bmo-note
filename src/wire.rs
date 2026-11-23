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
  /// The note's icon, one emoji; empty where it has none.
  pub icon: String,
  /// The owner's folder the note stands in; none where it stands in none, and always none to a member.
  pub folder: Option<String>,
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
  /// The document, its comment marks taken off.
  pub doc: Value,
}

/// A note with its document, its TipTap JSON (`docs/design.md`, 「What a note is」).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
  #[serde(flatten)]
  pub meta: NoteMeta,
  pub doc: Value,
}

/// A note to make: its title is read from its document.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNote {
  /// 1 to 64 letters, digits, `-` and `_`; one is made where none is given.
  #[serde(default)]
  pub id: Option<String>,
  pub doc: Value,
  /// The caller's folder the note is made in; none for the top.
  #[serde(default)]
  pub folder: Option<String>,
}

/// A save of a note: the version it was made from, and the fields it writes.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSave {
  /// The version the writer read; a save from behind the stored one is refused.
  pub version: i64,
  /// The whole document; the title, the text and the links are read from it.
  #[serde(default)]
  pub doc: Option<Value>,
  /// Moves a trashed note back to life; writes nothing else on a live note.
  #[serde(default)]
  pub restore: Option<bool>,
}

/// The order a list stands in (`docs/api.md`, 「Notes」).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ListOrder {
  /// Newest changed first.
  #[default]
  Changed,
  /// Newest made first.
  Created,
  /// By title, without regard to case, untitled notes last.
  Title,
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
  /// Answers the caller's live notes standing in the folder it names, or, empty, in none.
  #[serde(default)]
  pub folder: Option<String>,
  /// The order the rows stand in; newest changed first where none is named.
  #[serde(default)]
  pub sort: Option<ListOrder>,
  /// The cursor: the last row's key in the order named, its id, and its owner in the shared view.
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

/// A read of one note.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadQuery {
  /// The account a service-token call acts for; on a console call, the account whose note it reaches.
  #[serde(default)]
  pub owner: Option<String>,
  /// Records that the caller opened the note.
  #[serde(default)]
  pub opened: Option<bool>,
  /// Answers the caller's own note where it rests in the trash.
  #[serde(default)]
  pub deleted: Option<bool>,
}

/// A note's icon set or cleared.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteIcon {
  /// Empty clears it.
  pub icon: String,
}

/// A copy to make of a note.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCopy {
  /// 1 to 64 letters, digits, `-` and `_`; one is made where none is given.
  #[serde(default)]
  pub id: Option<String>,
  pub title: String,
}

/// A note the caller opened, with the moment it last did.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedNote {
  #[serde(flatten)]
  pub meta: NoteMeta,
  pub opened_at: i64,
}

/// The read of what was opened.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentQuery {
  #[serde(default)]
  pub limit: Option<i64>,
  /// The account a service-token call answers for.
  #[serde(default)]
  pub owner: Option<String>,
}

/// The order a search answers in (`docs/api.md`, 「Search」).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchOrder {
  /// Relevance, a title match weighing more and a recent change ahead.
  #[default]
  Best,
  Changed,
  Created,
}

/// A search.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
  #[serde(default)]
  pub q: Option<String>,
  /// The views searched, comma-separated: `mine`, `shared`, `trash`.
  #[serde(default, rename = "in")]
  pub within: Option<String>,
  #[serde(default)]
  pub title_only: Option<bool>,
  /// Epoch ms: the notes changed at or after it.
  #[serde(default)]
  pub since: Option<i64>,
  #[serde(default)]
  pub sort: Option<SearchOrder>,
  /// How many rows of the same search were already read.
  #[serde(default)]
  pub after: Option<i64>,
  #[serde(default)]
  pub limit: Option<i64>,
  /// The account a service-token call answers for.
  #[serde(default)]
  pub owner: Option<String>,
}

/// A stretch of a note's text around a match, and the places the terms stand in it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
  pub text: String,
  /// `[start, end)` in UTF-16 code units.
  pub hits: Vec<[usize; 2]>,
}

/// One note a search found.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
  #[serde(flatten)]
  pub meta: NoteMeta,
  /// The places the terms stand in the title, `[start, end)` in UTF-16 code units.
  pub title_hits: Vec<[usize; 2]>,
  /// Null where no term stands in the text, or the search read titles alone.
  pub snippet: Option<Snippet>,
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

/// One comment of a thread (`docs/api.md`, 「Comments」).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
  pub id: String,
  /// The account key that wrote it.
  pub author: String,
  pub body: String,
  pub created_at: i64,
  /// Whether the caller wrote it.
  #[serde(default)]
  pub mine: bool,
}

/// A comment thread laid on words of a note.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
  /// The id the comment marks laid for it carry.
  pub id: String,
  /// The words it was laid on, as they read then.
  pub quote: String,
  /// The account key that started it.
  pub author: String,
  pub created_at: i64,
  /// Null while it is open.
  pub resolved_at: Option<i64>,
  pub resolved_by: Option<String>,
  /// Whether the note's stored document holds a comment mark of the thread's id.
  pub anchored: bool,
  /// Whether the caller started it.
  #[serde(default)]
  pub mine: bool,
  /// Oldest first.
  pub comments: Vec<Comment>,
}

/// A thread to start, with its first comment.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewThread {
  pub id: String,
  #[serde(default)]
  pub quote: String,
  pub body: String,
}

/// A reply to a thread.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewComment {
  pub body: String,
}

/// A thread resolved or reopened.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadChange {
  pub resolved: bool,
}

/// The data `note.commented` carries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentEvent {
  pub note_id: String,
  pub owner: String,
  pub thread: String,
}

/// One of an account's folders (`docs/api.md`, 「Folders」).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
  pub id: String,
  /// The folder it stands in; none at the top.
  pub parent: Option<String>,
  pub name: String,
  pub created_at: i64,
}

/// A folder to make.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFolder {
  /// 1 to 64 letters, digits, `-` and `_`; one is made where none is given.
  #[serde(default)]
  pub id: Option<String>,
  pub name: String,
  /// The folder it is made in; none for the top.
  #[serde(default)]
  pub parent: Option<String>,
}

/// A folder renamed or moved: a field left out stays as it stands, and a `parent` of null moves it to the
/// top.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderChange {
  #[serde(default)]
  pub name: Option<String>,
  #[serde(default, deserialize_with = "given")]
  pub parent: Option<Option<String>>,
}

/// A field that is told apart left out (none) from given as null (some none).
fn given<'de, D: serde::Deserializer<'de>>(read: D) -> Result<Option<Option<String>>, D::Error> {
  Option::<String>::deserialize(read).map(Some)
}

/// A note moved into a folder, or into none.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFiling {
  pub folder: Option<String>,
}

/// What a bookmark names (`docs/api.md`, 「Bookmarks」).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BookmarkKind {
  Folder,
  Note,
  Line,
}

impl BookmarkKind {
  /// The word the store keeps the kind as.
  pub fn word(self) -> &'static str {
    match self {
      Self::Folder => "folder",
      Self::Note => "note",
      Self::Line => "line",
    }
  }

  /// The kind a stored word names; anything unknown reads as a note's.
  pub fn of_word(word: &str) -> Self {
    match word {
      "folder" => Self::Folder,
      "line" => Self::Line,
      _ => Self::Note,
    }
  }
}

/// One of the caller's bookmarks, with what it names as the caller reads it now.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
  pub id: String,
  pub kind: BookmarkKind,
  pub created_at: i64,
  /// The folder, for a folder's.
  pub folder: Option<Folder>,
  /// The note as the caller holds it, for a note's and a line's.
  pub note: Option<NoteMeta>,
  /// The block id a line's is anchored to.
  pub block: Option<String>,
  /// A line's words: the block's now where it stands, else the ones it held when it was made.
  pub quote: Option<String>,
  /// Whether a line's block stands in the note's stored document; true for the other kinds.
  pub anchored: bool,
}

/// A bookmark to make.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBookmark {
  pub kind: BookmarkKind,
  #[serde(default)]
  pub folder_id: Option<String>,
  #[serde(default)]
  pub note_id: Option<String>,
  /// The account the note belongs to, where it is not the caller's own.
  #[serde(default)]
  pub note_owner: Option<String>,
  #[serde(default)]
  pub block: Option<String>,
  #[serde(default)]
  pub quote: Option<String>,
}

/// The data `note.filed` carries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FiledEvent {
  pub note_id: String,
  pub owner: String,
  pub folder: Option<String>,
}

/// The data `folder.changed` carries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEvent {
  pub owner: String,
  pub folder_id: String,
}

/// The data `bookmark.changed` carries: the account whose bookmarks changed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEvent {
  pub owner: String,
}
