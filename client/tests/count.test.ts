import { describe, expect, test } from "bun:test";

import { countWords } from "../app/domain/count";

// What the status line counts (`docs/design.md`, 「The console surface」): the document's title and every
// text block under it, as runs of non-space. The shapes below stand for the block texts the fork hands.

const text = (value: string) => ({ toString: () => value });

describe("countWords", () => {
  test("the title and the text blocks are counted together", () => {
    expect(countWords({ props: { title: text("Budget plan") }, children: [{ props: { text: text("Ship it") } }] })).toBe(4);
  });

  test("a text block's text is read through its own props or its text field", () => {
    expect(countWords({ children: [{ props: { text: text("one two") } }, { text: text("three") }] })).toBe(3);
  });

  test("an older document's title field still counts", () => {
    expect(countWords({ title: text("Old title"), children: [] })).toBe(2);
  });

  test("a tree with nothing written counts none", () => {
    expect(countWords(null)).toBe(0);
    expect(countWords({ props: { title: text("   ") }, children: [{ props: { text: text("") } }] })).toBe(0);
  });

  test("children of children are walked", () => {
    expect(countWords({ children: [{ children: [{ props: { text: text("deep words") } }] }] })).toBe(2);
  });
});
