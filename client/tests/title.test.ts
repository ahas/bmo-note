import { describe, expect, test } from "bun:test";

import { noteTitle, TITLE_MAX } from "../app/domain/title";

// The title a note stands under in the list: the document's own, else the first line of content
// (`docs/design.md`, 「What a note is」). The shapes below stand for the block texts the fork hands:
// a plain `Y.Text`, a wrapper holding one, or a bare string.

const ytext = (value: string) => ({ toString: () => value });
const wrapped = (value: string) => ({ yText: { toString: () => value }, toString: () => `wrapped:${value}` });

describe("noteTitle", () => {
  test("the root's own title wins, in whichever field it rides", () => {
    expect(noteTitle({ props: { title$: ytext("Budget 2027") }, children: [{ text: ytext("first line") }] })).toBe("Budget 2027");
    expect(noteTitle({ props: { title: "Plain" }, children: [] })).toBe("Plain");
    expect(noteTitle({ props: { title: wrapped("Nested") }, children: [] })).toBe("Nested");
    expect(noteTitle({ title: ytext("Old document"), children: [{ text: ytext("first line") }] })).toBe("Old document");
  });

  test("an empty or blank root title falls through to the content", () => {
    expect(noteTitle({ props: { title$: ytext("   ") }, children: [{ text: ytext("Quarterly budget notes") }] })).toBe("Quarterly budget notes");
  });

  test("the first line of the first block carrying text titles the note", () => {
    const root = {
      children: [
        { children: [] },
        { text: ytext("") },
        { children: [{ text: ytext("  \n ") }] },
        { text: ytext("  Ship the   release\nsecond line\nthird") },
        { text: ytext("next block") }
      ]
    };

    expect(noteTitle(root)).toBe("Ship the release");
  });

  test("the line is capped where the service stores it", () => {
    const long = "あ".repeat(TITLE_MAX + 50);

    expect(Array.from(noteTitle({ children: [{ text: ytext(long) }] })).length).toBe(TITLE_MAX);
  });

  test("a document with nothing written stands without a title", () => {
    expect(noteTitle(null)).toBe("");
    expect(noteTitle({ children: [{ children: [{ text: ytext("") }] }] })).toBe("");
  });
});
