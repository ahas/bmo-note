//! The shapes the routes read a note through: the id rules, the title rules, the base64 of a document,
//! and the moments (`docs/api.md`, 「Notes」).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;

use crate::error::ApiError;

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

/// Whether an id is a BlockSuite blob key: the base64url of the bytes' digest — letters, digits, `-`,
/// `_` and the `=` padding — 1 to 128 of them.
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

/// A document as it is stored, from its base64 on the wire; at least one byte, at most `max` decoded.
pub fn decode_doc(given: &str, max: usize) -> Result<Vec<u8>, ApiError> {
  if given.len() > max * 4 / 3 + 8 {
    return Err(ApiError::too_large(max));
  }
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(given)
    .map_err(|_| ApiError::bad_doc("The doc is not base64."))?;
  if bytes.is_empty() {
    return Err(ApiError::bad_doc("The doc holds no bytes."));
  }
  if bytes.len() > max {
    return Err(ApiError::too_large(max));
  }
  Ok(bytes)
}

/// The document as it travels: bytes to base64.
pub fn encode_doc(bytes: &[u8]) -> String {
  base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// The cursor an `after` query names, where it reads.
pub fn parse_cursor(after: &str) -> Option<(i64, String)> {
  let (moment, id) = after.split_once(':')?;
  Some((moment.parse().ok()?, id.to_owned()))
}
