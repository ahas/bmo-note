import { describe, expect, test } from "bun:test";

import { lineOf, opaqueLine, opaqueRow, rowOf, rowsOf, linesOf } from "../app/domain/text";

import type { Row } from "../app/domain/text";

// The line protocol of the AI talk (`docs/design.md`, 「The AI talk panel」): one line per block,
// every row read back whole.

describe("lineOf / rowOf", () => {
  test("each kind wears its own line and reads back unchanged", () => {
    const rows: Row[] = [
      { kind: "text", text: "Quarterly notes", indent: 0 },
      { kind: "h1", text: "Budget", indent: 0 },
      { kind: "h2", text: "Q1", indent: 0 },
      { kind: "h3", text: "Detail", indent: 0 },
      { kind: "bulleted", text: "milk", indent: 0 },
      { kind: "numbered", text: "first", indent: 0 },
      { kind: "todo", text: "ship", indent: 0 },
      { kind: "todo-done", text: "plan", indent: 0 },
      { kind: "quote", text: "as the owner said", indent: 0 },
      { kind: "code", text: "let a = 1;\nlet b = 2;", indent: 0 },
      { kind: "divider", text: "", indent: 0 },
      { kind: "image", text: "", indent: 0 },
      { kind: "table", text: "", indent: 0 },
      { kind: "bulleted", text: "nested", indent: 1 },
      { kind: "text", text: "", indent: 0 }
    ];

    expect(rowsOf(linesOf(rows))).toEqual(rows);
  });

  test("the text of a line holds no raw newline, tab, or bare edge space", () => {
    const tricky: Row[] = [
      { kind: "text", text: "line\nnext\ttabbed", indent: 0 },
      { kind: "text", text: "  padded  ", indent: 0 },
      { kind: "text", text: "back\\slash and - not a mark", indent: 0 },
      { kind: "text", text: "# heading-ish at the start", indent: 0 },
      { kind: "text", text: "1. numbered-ish", indent: 0 },
      { kind: "text", text: "[[image]] looked like a sentinel", indent: 0 }
    ];

    for (const row of tricky) {
      const line = lineOf(row);

      expect(line).not.toContain("\n");
      expect(rowsOf([line])[0]).toEqual(row);
    }
  });

  test("a paragraph never answers as a mark, however its text reads", () => {
    expect(rowOf("\\# not a heading")).toEqual({ kind: "text", text: "# not a heading", indent: 0 });
    expect(rowOf("\\- not a bullet")).toEqual({ kind: "text", text: "- not a bullet", indent: 0 });
  });

  test("numbered lines answer as numbered items whatever digit they wore", () => {
    expect(rowOf("3. third").kind).toBe("numbered");
  });
});

describe("opaque lines", () => {
  test("images and tables read opaque from the row and from the line alike", () => {
    expect(opaqueRow({ kind: "image", text: "", indent: 0 })).toBe(true);
    expect(opaqueRow({ kind: "table", text: "", indent: 0 })).toBe(true);
    expect(opaqueRow({ kind: "divider", text: "", indent: 0 })).toBe(false);
    expect(opaqueLine("[[image]]")).toBe(true);
    expect(opaqueLine("    [[table]]")).toBe(true);
    expect(opaqueLine("- keep [[image]] in the sentence")).toBe(false);
  });

  test("a paragraph whose own words end with a mark reads as the paragraph it is", () => {
    expect(opaqueLine("paste [[image]] at the end")).toBe(false);
    expect(opaqueLine("\\[[image]] escaped")).toBe(false);
  });

  test("words opening with the title mark wear an escape and read back whole", () => {
    const row: Row = { kind: "text", text: "[[title]] not a rename", indent: 0 };
    const line = lineOf(row);

    expect(line.startsWith("\\[")).toBe(true);
    expect(rowOf(line)).toEqual(row);
    expect(opaqueLine(line)).toBe(false);
  });
});
