import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";

import { blockAround, blockIdAt, blocksToMark, blockWords, markBlocks } from "../app/domain/blocks";
import { noteExtensions } from "../app/domain/extensions";

// The block ids of a note (docs/design.md, 「What a note is」): every block carries one, a block written without
// one takes one, a copy repeating one takes its own, and the block under the caret is found by them.

const schema = getSchema([StarterKit.configure({ document: false }), ...noteExtensions({ href: () => "", untitled: "", image: () => "" })]);

function docOf(blocks: unknown[]) {
  return schema.nodeFromJSON({ type: "doc", content: [{ type: "title", content: [{ type: "text", text: "Plan" }] }, ...blocks] });
}

const line = (text: string, block?: string) => ({ type: "paragraph", ...(block === undefined ? {} : { attrs: { block } }), content: [{ type: "text", text }] });

function counter(): () => string {
  let count = 0;

  return () => `b${(count += 1)}`;
}

describe("the block ids", () => {
  test("are written onto every block holding none, and onto a copy repeating one, never onto the title", () => {
    const doc = docOf([line("Buy milk", "keep"), line("Call"), line("Buy milk", "keep"), { type: "bulletList", content: [{ type: "listItem", content: [line("item")] }] }]);
    const marked = blocksToMark(doc, counter());

    expect(marked.map(([, id]) => id)).toEqual(["b1", "b2", "b3", "b4", "b5"]);

    const state = EditorState.create({ schema, doc });
    const written = markBlocks(state, counter())!.doc.toJSON() as { content: { type: string; attrs?: { block?: string } }[] };

    expect(written.content.map((node) => node.attrs?.block ?? null)).toEqual([null, "keep", "b1", "b2", "b3"]);
  });

  test("leave a document whose blocks all hold their own as it stands", () => {
    const state = EditorState.create({ schema, doc: docOf([line("One", "a"), line("Two", "b")]) });

    expect(markBlocks(state)).toBeNull();
  });

  test("name the block under the caret, the innermost that carries one, with its words on one line", () => {
    const doc = docOf([line("Intro", "a"), { type: "bulletList", attrs: { block: "list" }, content: [{ type: "listItem", attrs: { block: "item" }, content: [line("Nested  words", "inner")] }] }]);
    let caret = 0;

    doc.descendants((node, pos) => {
      if (node.isText && node.text?.startsWith("Nested")) caret = pos + 2;
    });

    const at = blockAround(doc, caret)!;

    expect(blockIdAt(doc, at)).toBe("inner");
    expect(blockWords(doc.nodeAt(at)!)).toBe("Nested words");
    expect(blockIdAt(doc, 0)).toBeNull();
  });
});
