// The open editor's document as the screen reads and writes it whole (`docs/design.md`, 「Editing and
// saving」, 「The talk panel」): a new note's document, a document written back as one transaction that
// replaces only the top-level blocks that changed — so the caret and the reader's own edits elsewhere stand,
// and one undo takes the change back — and the places the comment marks stand.

import { titleOf } from "./title";

import type { Editor } from "@tiptap/core";
import type { DocNode } from "./rows";

/** A new note's document: an empty title and one empty paragraph for the caret. */
export function emptyDoc(title = ""): DocNode {
  return {
    type: "doc",
    content: [title === "" ? { type: "title" } : { type: "title", content: [{ type: "text", text: title }] }, { type: "paragraph" }]
  };
}

/** The range of top-level blocks two documents differ in: how many stand the same at the front and at the end. */
export function changedRange(before: DocNode[], after: DocNode[]): { front: number; back: number } {
  const same = (left: DocNode | undefined, right: DocNode | undefined): boolean => JSON.stringify(left) === JSON.stringify(right);
  let front = 0;

  while (front < before.length && front < after.length && same(before[front], after[front])) front += 1;

  let back = 0;

  while (back < before.length - front && back < after.length - front && same(before[before.length - 1 - back], after[after.length - 1 - back])) back += 1;

  return { front, back };
}

/** Writes `next` into the open editor as one transaction, replacing only the top-level blocks that differ from
 * what it holds. Answers whether anything changed. */
export function writeDoc(editor: Editor, next: DocNode): boolean {
  const { state } = editor;
  const before = (state.doc.toJSON() as DocNode).content ?? [];
  const after = next.content ?? [];
  const { front, back } = changedRange(before, after);

  if (front === before.length && front === after.length) return false;

  let from = 0;

  for (let at = 0; at < front; at += 1) from += state.doc.child(at).nodeSize;

  let to = state.doc.content.size;

  for (let at = 0; at < back; at += 1) to -= state.doc.child(state.doc.childCount - 1 - at).nodeSize;

  const nodes = after.slice(front, after.length - back).map((node) => state.schema.nodeFromJSON(node));
  const transaction = state.tr.replaceWith(from, to, nodes);

  editor.view.dispatch(transaction);

  return true;
}

/** Where each thread's comment marks first stand in the document, by thread id. */
export function commentPlaces(editor: Editor): Map<string, number> {
  const places = new Map<string, number>();

  editor.state.doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      const thread = mark.type.name === "comment" ? String(mark.attrs.thread ?? "") : "";

      if (thread !== "" && !places.has(thread)) places.set(thread, pos);
    }
  });

  return places;
}

/** Takes every comment mark of `thread` off the document, as one transaction. */
export function dropComment(editor: Editor, thread: string): void {
  const type = editor.schema.marks.comment;

  if (type === undefined) return;

  const transaction = editor.state.tr;

  editor.state.doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type === type && mark.attrs.thread === thread) transaction.removeMark(pos, pos + node.nodeSize, mark);
    }
  });

  if (transaction.docChanged) editor.view.dispatch(transaction);
}

/** The document as the save writes it, with the title the list will show. */
export function snapshotOf(editor: Editor): { doc: DocNode; title: string } {
  const doc = editor.getJSON() as DocNode;

  return { doc, title: titleOf(doc) };
}
