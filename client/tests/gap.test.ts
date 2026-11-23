import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

import { gapAfter, gapPlace, noteExtensions } from "../app/domain/extensions";

import type { Node as ProseNode } from "@tiptap/pm/model";

// Where a comment's gap opens (`docs/design.md`, 「Comments」): under the line holding the words, under the
// table they stand in, under a thread's words wherever they stand, and at the note's end for a thread whose
// words were deleted.

const schema = getSchema([StarterKit.configure({ document: false }), ...noteExtensions({ href: () => "", untitled: "", image: () => "" })]);

const text = (words: string, thread?: string) => ({ type: "text", text: words, ...(thread === undefined ? {} : { marks: [{ type: "comment", attrs: { thread } }] }) });
const line = (...content: object[]) => ({ type: "paragraph", content });

function docOf(...blocks: object[]): ProseNode {
  return schema.nodeFromJSON({ type: "doc", content: [{ type: "title", content: [text("T")] }, ...blocks] });
}

/** The position right after the block at `index` among the document's top-level blocks, the title first. */
function after(doc: ProseNode, index: number): number {
  let pos = 0;

  for (let at = 0; at <= index; at += 1) pos += doc.child(at).nodeSize;

  return pos;
}

describe("gapAfter", () => {
  test("opens under the line holding the place, and a place between lines stands as it is", () => {
    const doc = docOf(line(text("first line")), line(text("second line")));

    expect(gapAfter(doc, after(doc, 0) + 3)).toBe(after(doc, 1));
    expect(gapAfter(doc, after(doc, 1))).toBe(after(doc, 1));
  });

  test("opens under the list item's own line, inside the list", () => {
    const doc = docOf({ type: "bulletList", content: [{ type: "listItem", content: [line(text("one"))] }, { type: "listItem", content: [line(text("two"))] }] });
    const inFirst = after(doc, 0) + 3;
    const at = doc.resolve(gapAfter(doc, inFirst));

    expect(at.parent.type.name).toBe("listItem");
    expect(at.parent.textContent).toBe("one");
  });

  test("opens under a table, never inside its cell", () => {
    const cell = (words: string) => ({ type: "tableCell", content: [line(text(words))] });
    const doc = docOf({ type: "table", content: [{ type: "tableRow", content: [cell("a"), cell("b")] }] }, line(text("after")));

    expect(gapAfter(doc, after(doc, 0) + 5)).toBe(after(doc, 1));
  });
});

describe("gapPlace", () => {
  const doc = docOf(line(text("plain "), text("marked", "t1")), line(text("next")));

  test("a draft's words that run to the next line's start open under their own line", () => {
    expect(gapPlace(doc, { draft: { from: after(doc, 0) + 1, to: after(doc, 1) + 1 } })).toBe(after(doc, 1));
  });

  test("a thread opens under its words, and one whose words are gone at the note's end", () => {
    expect(gapPlace(doc, { thread: "t1" })).toBe(after(doc, 1));
    expect(gapPlace(doc, { thread: "gone" })).toBe(doc.content.size);
  });
});
