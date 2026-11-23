//! The shapes the routes read a note through: the id rules, the title rules, the words of a comment,
//! and the moments (`docs/api.md`, 「Notes」).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;

use crate::error::ApiError;
use crate::wire::ListOrder;

/// The most characters a title holds.
pub const TITLE_MAX: usize = 300;

/// The moment now, epoch ms.
pub fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|since| since.as_millis() as i64)
    .unwrap_or(0)
}

/// Whether an id is 1 to 64 letters, digits, `-` and `_`.
pub fn valid_id(id: &str) -> bool {
  (1..=64).contains(&id.len())
    && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Whether an id names an image: letters, digits, `-`, `_` and `=`, 1 to 128 of them — the editor's ids,
/// and the base64url digests the earlier editor named its images by.
pub fn valid_blob_id(id: &str) -> bool {
  (1..=128).contains(&id.len())
    && id
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'='))
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// An id the service made: the moment in seconds and a count, in lowercase hex.
pub fn fresh_id() -> String {
  let seconds = (now_ms() / 1000) as u32;
  let count = COUNTER.fetch_add(1, Ordering::Relaxed) as u32;
  format!("{seconds:08x}{count:08x}")
}

/// A title as it is stored: trimmed, one line, at most `TITLE_MAX` characters.
pub fn clean_title(title: &str) -> Result<String, ApiError> {
  let title = title.trim();
  if title.chars().any(|ch| (ch as u32) < 0x20 && !matches!(ch, '\t' | '\n' | '\r')) {
    return Err(ApiError::bad_request("The title holds control characters."));
  }
  let title = title.replace(['\t', '\n', '\r'], " ");
  let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
  if title.chars().count() > TITLE_MAX {
    return Err(ApiError::bad_request(format!("The title is over {TITLE_MAX} characters.")));
  }
  Ok(title)
}

/// Where a list page starts: the last row's key in the order named, its id, and, in the shared view, its
/// owner (`docs/api.md`, 「Notes」).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListCursor {
  pub key: CursorKey,
  pub id: String,
  pub owner: Option<String>,
}

/// The ordering key a cursor carries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CursorKey {
  /// A moment, epoch ms: the change or the creation.
  Moment(i64),
  /// A title.
  Title(String),
}

/// The cursor an `after` query names for `order`, where it reads: `<key>:id`, and `:owner` after it in the
/// shared view, the key a moment or, by title, the title's unpadded base64url. An owner key may itself hold
/// colons; an id never does.
pub fn parse_list_cursor(order: ListOrder, after: &str, shared: bool) -> Option<ListCursor> {
  let (head, rest) = after.split_once(':')?;
  let key = match order {
    ListOrder::Changed | ListOrder::Created => CursorKey::Moment(head.parse().ok()?),
    ListOrder::Title => {
      let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(head).ok()?;
      CursorKey::Title(String::from_utf8(bytes).ok()?)
    }
  };
  let (id, owner) = if shared {
    let (id, owner) = rest.split_once(':')?;
    (id, Some(owner.to_owned()))
  } else {
    (rest, None)
  };
  if id.is_empty() {
    return None;
  }
  Some(ListCursor {
    key,
    id: id.to_owned(),
    owner,
  })
}

/// The words a note id never is, since they name routes standing under `/notes`.
pub const RESERVED_IDS: [&str; 3] = ["search", "pinned", "recent"];

/// Whether an id may name a note a write makes: a valid id that names no route.
pub fn makeable_id(id: &str) -> bool {
  valid_id(id) && !RESERVED_IDS.contains(&id)
}

/// The most characters an icon holds.
pub const ICON_MAX: usize = 16;

/// An icon as it is stored: its ends trimmed, at most `ICON_MAX` characters, no control character.
pub fn clean_icon(icon: &str) -> Result<String, ApiError> {
  let icon = icon.trim();
  if icon.chars().any(char::is_control) {
    return Err(ApiError::bad_request("The icon holds control characters."));
  }
  if icon.chars().count() > ICON_MAX {
    return Err(ApiError::bad_request(format!("The icon is over {ICON_MAX} characters.")));
  }
  Ok(icon.to_owned())
}

/// The bytes of randomness a link's token is made of.
const TOKEN_BYTES: usize = 24;

/// A share link's token: random bytes from the system's source, as 32 base64url characters.
pub fn fresh_token() -> Result<String, String> {
  use std::io::Read;
  let mut bytes = [0u8; TOKEN_BYTES];
  std::fs::File::open("/dev/urandom")
    .and_then(|mut source| source.read_exact(&mut bytes))
    .map_err(|why| format!("the system's randomness: {why}"))?;
  Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/// The most characters an account key holds, as the console's `Owner-Key` is held to.
pub const KEY_MAX: usize = 200;

/// The most characters a comment's words hold, and the words a thread was laid on.
pub const COMMENT_MAX: usize = 10_000;
pub const QUOTE_MAX: usize = 1_000;

/// A comment's words as they are stored: their ends trimmed, 1 to `COMMENT_MAX` characters.
pub fn clean_comment(body: &str) -> Result<String, ApiError> {
  let body = body.trim();
  if body.is_empty() || body.chars().count() > COMMENT_MAX {
    return Err(ApiError::bad_request(format!("A comment is 1 to {COMMENT_MAX} characters.")));
  }
  Ok(body.to_owned())
}

/// The words a thread was laid on, as they are stored: at most `QUOTE_MAX` characters.
pub fn clean_quote(quote: &str) -> Result<String, ApiError> {
  if quote.chars().count() > QUOTE_MAX {
    return Err(ApiError::bad_request(format!("A quote is at most {QUOTE_MAX} characters.")));
  }
  Ok(quote.to_owned())
}
