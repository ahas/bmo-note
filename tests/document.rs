//! What the service reads of a document (`docs/design.md`, 「What a note is」): its title, its plain text,
//! its links and the threads its marks anchor, and the two writes of its own — a copy's title and the
//! comment marks taken off.

use bmo_note::doc::{checked, derived, parsed, threads, titled, without_comments};
use serde_json::json;

#[test]
fn the_title_text_and_links_are_read_from_the_tree() {
  let doc = json!({ "type": "doc", "content": [
    { "type": "title", "content": [{ "type": "text", "text": "  Plan \n A " }] },
    { "type": "paragraph", "content": [
      { "type": "text", "text": "See " },
      { "type": "mention", "attrs": { "id": "n2", "owner": "7", "label": "Other" } },
      { "type": "text", "text": "!", "marks": [{ "type": "comment", "attrs": { "thread": "t1" } }] }
    ] },
    { "type": "paragraph" },
    { "type": "bulletList", "content": [{ "type": "listItem", "content": [
      { "type": "paragraph", "content": [{ "type": "text", "text": "one" }] },
      { "type": "bulletList", "content": [{ "type": "listItem", "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "two" }] }
      ] }] }
    ] }] },
    { "type": "codeBlock", "attrs": { "language": "rust" }, "content": [{ "type": "text", "text": "let a = 1;" }] },
    { "type": "image", "attrs": { "blob": "b1" } },
    { "type": "table", "content": [{ "type": "tableRow", "content": [
      { "type": "tableCell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "cell" }] }] }
    ] }] }
  ] });
  let said = derived(&doc);
  assert_eq!(said.title, "Plan A");
  assert_eq!(said.text, "See Other!\none\ntwo\nlet a = 1;\ncell");
  assert_eq!(said.links.into_iter().collect::<Vec<_>>(), vec![("7".to_owned(), "n2".to_owned())]);
  assert_eq!(threads(&doc).into_iter().collect::<Vec<_>>(), vec!["t1".to_owned()]);
  assert!(threads(&without_comments(&doc)).is_empty());
}

#[test]
fn an_untitled_document_takes_its_first_line_and_a_copy_takes_its_title() {
  let doc = json!({ "type": "doc", "content": [
    { "type": "title" },
    { "type": "paragraph", "content": [{ "type": "text", "text": "first" }, { "type": "hardBreak" }, { "type": "text", "text": "second" }] }
  ] });
  assert_eq!(derived(&doc).title, "first");
  assert_eq!(derived(&titled(&doc, "Copy")).title, "Copy");
  let bare = json!({ "type": "doc", "content": [] });
  assert_eq!(titled(&bare, "Named")["content"][0]["type"], "title");
}

#[test]
fn a_shape_other_than_a_document_is_refused() {
  assert!(checked(&json!({ "type": "doc", "content": [] }), 100).is_ok());
  for wrong in [json!("doc"), json!({ "type": "page" }), json!({ "type": "doc", "content": [1] })] {
    assert_eq!(checked(&wrong, 100).map_err(|error| error.code), Err("bad-doc"));
  }
  assert_eq!(
    checked(&json!({ "type": "doc", "content": [] }), 10).map_err(|error| error.code),
    Err("too-large")
  );
  assert!(parsed(&[0x01, 0x02]).is_none(), "the earlier editor's bytes are no document");
}
