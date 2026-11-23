//! A note's document as the service reads it (`docs/design.md`, 「What a note is」): the ProseMirror JSON of
//! one TipTap document, a `doc` node holding a `title` node and the note's blocks. The client alone writes
//! it; the service checks its shape, and derives from it the note's title, its plain text for search, the
//! notes it links and the comment threads its marks anchor. Two writes of its own are the service's: a
//! copy's title written into its title node, and the comment marks taken off.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::error::ApiError;
use crate::model::{KEY_MAX, TITLE_MAX, valid_id};

/// The node types that stand inside a line of words; every other node is a block.
const INLINE: [&str; 3] = ["text", "mention", "hardBreak"];

/// What a document says, as the service keeps it beside the document.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Derived {
  /// The title node's words, else the first line of words the blocks hold, at most `TITLE_MAX` characters.
  pub title: String,
  /// Every block's words, one line a block, the blocks holding none left out.
  pub text: String,
  /// The notes the document links to, each by its owner's key and its id, each once.
  pub links: BTreeSet<(String, String)>,
}

/// A document as a write hands it: refused `bad-doc` where it is not one object of type `doc` holding an
/// array of nodes, each an object with a string type; its stored bytes refused `too-large` past `max`.
pub fn checked(doc: &Value, max: usize) -> Result<Vec<u8>, ApiError> {
  if !is_document(doc) {
    return Err(ApiError::bad_doc(
      "The doc is not a TipTap document: an object of type doc holding an array of nodes.",
    ));
  }
  let bytes = serde_json::to_vec(doc).map_err(|why| ApiError::bad_doc(why.to_string()))?;
  if bytes.len() > max {
    return Err(ApiError::too_large(max));
  }
  Ok(bytes)
}

/// Whether a value has the shape of a document: a `doc` node whose content is an array of typed nodes.
pub fn is_document(doc: &Value) -> bool {
  doc.get("type").and_then(Value::as_str) == Some("doc")
    && doc
      .get("content")
      .and_then(Value::as_array)
      .is_some_and(|nodes| nodes.iter().all(|node| node.get("type").and_then(Value::as_str).is_some()))
}

/// The document stored bytes hold, where they hold one of this format.
pub fn parsed(bytes: &[u8]) -> Option<Value> {
  let doc: Value = serde_json::from_slice(bytes).ok()?;
  is_document(&doc).then_some(doc)
}

/// What a document says: its title, its plain text and its links.
pub fn derived(doc: &Value) -> Derived {
  let nodes = children(doc);
  let own_title = nodes
    .iter()
    .find(|node| kind(node) == "title")
    .map(|node| one_line(&words_of(node)))
    .unwrap_or_default();
  let mut lines = Vec::new();
  for node in nodes.iter().filter(|node| kind(node) != "title") {
    lines_of(node, &mut lines);
  }
  let lines: Vec<String> = lines.into_iter().filter(|line| !line.trim().is_empty()).collect();
  let title = if own_title.is_empty() {
    lines
      .first()
      .map(|line| one_line(line.lines().next().unwrap_or("")))
      .unwrap_or_default()
  } else {
    own_title
  };
  let mut links = BTreeSet::new();
  links_of(doc, &mut links);
  Derived {
    title: title.chars().take(TITLE_MAX).collect(),
    text: lines.join("\n"),
    links,
  }
}

/// The thread ids the document's comment marks carry.
pub fn threads(doc: &Value) -> BTreeSet<String> {
  let mut found = BTreeSet::new();
  threads_of(doc, &mut found);
  found
}

/// The document with its title node holding `title` alone, made first where it holds none.
pub fn titled(doc: &Value, title: &str) -> Value {
  let mut doc = doc.clone();
  let title_node = if title.is_empty() {
    serde_json::json!({ "type": "title" })
  } else {
    serde_json::json!({ "type": "title", "content": [{ "type": "text", "text": title }] })
  };
  if let Some(nodes) = doc.get_mut("content").and_then(Value::as_array_mut) {
    match nodes.iter().position(|node| kind(node) == "title") {
      Some(at) => nodes[at] = title_node,
      None => nodes.insert(0, title_node),
    }
  }
  doc
}

/// The document with every comment mark taken off: what a copy and a share link are given.
pub fn without_comments(doc: &Value) -> Value {
  let mut doc = doc.clone();
  strip_comments(&mut doc);
  doc
}

fn strip_comments(node: &mut Value) {
  let Some(object) = node.as_object_mut() else {
    return;
  };
  if let Some(marks) = object.get_mut("marks").and_then(Value::as_array_mut) {
    marks.retain(|mark| kind(mark) != "comment");
    if marks.is_empty() {
      object.remove("marks");
    }
  }
  if let Some(nodes) = object.get_mut("content").and_then(Value::as_array_mut) {
    nodes.iter_mut().for_each(strip_comments);
  }
}

/// The most characters a line bookmark's words hold.
pub const LINE_WORDS_MAX: usize = 300;

/// The words the block whose `block` attribute is `id` holds, its lines laid on one line and cut to
/// `LINE_WORDS_MAX` characters; none where no block of that id stands (`docs/design.md`, 「Bookmarks」).
pub fn block_words(doc: &Value, id: &str) -> Option<String> {
  let block = block_of(doc, id)?;
  let mut lines = Vec::new();
  lines_of(block, &mut lines);
  Some(one_line(&lines.join(" ")).chars().take(LINE_WORDS_MAX).collect())
}

fn block_of<'a>(node: &'a Value, id: &str) -> Option<&'a Value> {
  if kind(node) != "text" && attr(node, "block") == Some(id) {
    return Some(node);
  }
  children(node).iter().find_map(|child| block_of(child, id))
}

fn kind(node: &Value) -> &str {
  node.get("type").and_then(Value::as_str).unwrap_or("")
}

fn children(node: &Value) -> &[Value] {
  node.get("content").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

fn attrs(node: &Value) -> Option<&Map<String, Value>> {
  node.get("attrs").and_then(Value::as_object)
}

fn attr<'a>(node: &'a Value, name: &str) -> Option<&'a str> {
  attrs(node)?.get(name)?.as_str()
}

/// The words of one line: its text, a note link's title, a hard break as a line break.
fn words_of(node: &Value) -> String {
  match kind(node) {
    "text" => node.get("text").and_then(Value::as_str).unwrap_or("").to_owned(),
    "mention" => attr(node, "label").unwrap_or("").to_owned(),
    "hardBreak" => "\n".to_owned(),
    _ => children(node).iter().map(words_of).collect(),
  }
}

/// Every line of words a block holds: the block itself where it holds words, else each block inside it.
fn lines_of(node: &Value, lines: &mut Vec<String>) {
  let nodes = children(node);
  if nodes.iter().any(|child| INLINE.contains(&kind(child))) {
    lines.push(words_of(node));
    return;
  }
  for child in nodes {
    lines_of(child, lines);
  }
}

fn links_of(node: &Value, links: &mut BTreeSet<(String, String)>) {
  if kind(node) == "mention"
    && let (Some(id), Some(owner)) = (attr(node, "id"), attr(node, "owner"))
    && valid_id(id)
    && !owner.is_empty()
    && owner.chars().count() <= KEY_MAX
  {
    links.insert((owner.to_owned(), id.to_owned()));
  }
  for child in children(node) {
    links_of(child, links);
  }
}

fn threads_of(node: &Value, found: &mut BTreeSet<String>) {
  for mark in node.get("marks").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]) {
    if kind(mark) == "comment"
      && let Some(thread) = attr(mark, "thread")
    {
      found.insert(thread.to_owned());
    }
  }
  for child in children(node) {
    threads_of(child, found);
  }
}

/// Words laid on one line: every run of white space, line breaks and control characters among it, one
/// space, the ends trimmed.
fn one_line(words: &str) -> String {
  words
    .split(|ch: char| ch.is_whitespace() || ch.is_control())
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
}
