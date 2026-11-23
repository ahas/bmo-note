import { describe, expect, test } from "bun:test";

import { titleOf, TITLE_MAX } from "../app/domain/title";

import type { DocNode } from "../shared/types";

// The title a note stands under: the title node's words, else the first line of words the blocks hold
// (`docs/design.md`, 「What a note is」), as the service reads it.

const doc = (title: string, ...blocks: DocNode[]): DocNode => ({
  type: "doc",
  content: [title === "" ? { type: "title" } : { type: "title", content: [{ type: "text", text: title }] }, ...blocks]
});
const paragraph = (...content: DocNode[]): DocNode => (content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content });
const text = (words: string): DocNode => ({ type: "text", text: words });

describe("titleOf", () => {
  test("the title node wins, laid on one line", () => {
    expect(titleOf(doc("  Budget\t 2027 ", paragraph(text("first line"))))).toBe("Budget 2027");
  });

  test("an empty title falls through to the first line of words, a line break ending it", () => {
    const untitled = doc("", paragraph(), paragraph(text("  Ship the   release"), { type: "hardBreak" }, text("second")), paragraph(text("next")));

    expect(titleOf(untitled)).toBe("Ship the release");
  });

  test("a list item's words title a note as a paragraph's do", () => {
    const listed = doc("", { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("milk"))] }] });

    expect(titleOf(listed)).toBe("milk");
  });

  test("the line is capped where the service stores it", () => {
    expect(Array.from(titleOf(doc("あ".repeat(TITLE_MAX + 50)))).length).toBe(TITLE_MAX);
  });

  test("a document with nothing written stands without a title", () => {
    expect(titleOf(doc("", paragraph()))).toBe("");
  });
});
