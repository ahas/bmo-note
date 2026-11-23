import { describe, expect, test } from "bun:test";

import { countWords } from "../app/domain/count";

import type { DocNode } from "../shared/types";

// What the bar's line counts (`docs/design.md`, 「The console surface」): the title and every block's words,
// block by block, as runs of non-space.

const text = (words: string): DocNode => ({ type: "text", text: words });

describe("countWords", () => {
  test("the title and the blocks are counted together, a block's end parting two words", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        { type: "title", content: [text("Budget plan")] },
        { type: "paragraph", content: [text("Ship")] },
        { type: "paragraph", content: [text("it now")] }
      ]
    };

    expect(countWords(doc)).toBe(5);
  });

  test("lists, tables and code are walked; a note link counts its title", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        { type: "title" },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [text("deep words")] }] }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph", content: [text("cell")] }] }] }] },
        { type: "codeBlock", content: [text("let a")] },
        { type: "paragraph", content: [{ type: "mention", attrs: { id: "n2", owner: "1", label: "Other note" } }] }
      ]
    };

    expect(countWords(doc)).toBe(7);
  });

  test("a document with nothing written counts none", () => {
    expect(countWords({ type: "doc", content: [{ type: "title" }, { type: "paragraph" }] })).toBe(0);
  });
});
