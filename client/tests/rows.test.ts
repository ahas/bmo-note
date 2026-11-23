import { describe, expect, test } from "bun:test";

import { docOfRows, linesOfRun, nodeSize, patchedDoc, retitledDoc, rewrittenDoc, rowsOfDoc, runAt, titleNode } from "../app/domain/rows";
import { linesOf } from "../app/domain/text";

import type { DocNode } from "../shared/types";

// The note read as the talk's rows and written back from them (`docs/design.md`, 「The talk panel」, 「Agent」): one row a block, an untouched row written back as the node it was, every row knowing its place.

const text = (words: string, marks?: DocNode["marks"]): DocNode => (marks === undefined ? { type: "text", text: words } : { type: "text", text: words, marks });
const paragraph = (...content: DocNode[]): DocNode => (content.length === 0 ? { type: "paragraph" } : { type: "paragraph", content });
const item = (...content: DocNode[]): DocNode => ({ type: "listItem", content });

const bold = text("Plan", [{ type: "bold" }]);
const linked: DocNode = { type: "mention", attrs: { id: "n2", owner: "1", label: "Other" } };
const commented = text("see", [{ type: "comment", attrs: { thread: "t1" } }]);

const doc: DocNode = {
  type: "doc",
  content: [
    { type: "title", content: [text("Week")] },
    { type: "heading", attrs: { level: 2 }, content: [bold] },
    paragraph(commented, text(" "), linked),
    { type: "bulletList", content: [item(paragraph(text("milk")), { type: "bulletList", content: [item(paragraph(text("oat")))] }), item(paragraph(text("eggs")))] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph(text("call"))] }] },
    { type: "orderedList", attrs: { start: 3 }, content: [item(paragraph(text("three")))] },
    { type: "blockquote", content: [paragraph(text("said")), paragraph(text("more"))] },
    { type: "codeBlock", attrs: { language: "rust" }, content: [text("let a = 1;\nlet b = 2;")] },
    { type: "horizontalRule" },
    { type: "image", attrs: { blob: "b1" } },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [paragraph(text("cell"))] }] }] }
  ]
};

describe("rowsOfDoc", () => {
  test("each block is one row in the line grammar, a deeper item two spaces in", () => {
    expect(linesOf(rowsOfDoc(doc))).toEqual([
      "## Plan",
      "see Other",
      "- milk",
      "  - oat",
      "- eggs",
      "- [x] call",
      "1. three",
      "> said",
      "> more",
      "```\tlet a = 1;\\nlet b = 2;",
      "[[divider]]",
      "[[image]]",
      "[[table]]"
    ]);
  });

  test("the document built again from its rows is the document", () => {
    expect(docOfRows(titleNode(doc), rowsOfDoc(doc))).toEqual(doc);
  });

  test("every row knows where its node stands", () => {
    const rows = rowsOfDoc(doc);
    const titleSize = nodeSize(doc.content![0]!);

    expect(rows[0]!.from).toBe(titleSize);
    expect(rows[0]!.to).toBe(titleSize + nodeSize(doc.content![1]!));
    // A list item's row is its own paragraph, inside the list and the item.
    expect(rows[2]!.from).toBe(rows[1]!.to + 2);
  });
});

describe("patchedDoc", () => {
  test("a run written from the answer becomes plain words of its kind, the rows around it standing as they were", () => {
    const next = patchedDoc(doc, [{ at: 2, del: 1, insert: ["- butter", "- jam"] }]);
    const lines = linesOf(rowsOfDoc(next));

    // The item nested under the run's last line stands under the new last line.
    expect(lines.slice(0, 6)).toEqual(["## Plan", "see Other", "- butter", "- jam", "  - oat", "- eggs"]);
    // The untouched rows keep their marks, their note link and their comment mark.
    expect(next.content![1]).toEqual(doc.content![1]);
    expect(next.content![2]).toEqual(doc.content![2]);
  });

  test("an insert at the end and a run past the note", () => {
    const longer = patchedDoc(doc, [{ at: 13, del: 0, insert: ["### Next"] }]);

    expect(longer.content!.at(-1)).toEqual({ type: "heading", attrs: { level: 3 }, content: [text("Next")] });
    expect(() => patchedDoc(doc, [{ at: 20, del: 1, insert: [] }])).toThrow();
  });
});

describe("rewrittenDoc", () => {
  test("the whole body is written from the answer, the image and the table moved whole and every line kept as it was", () => {
    const answer = ["[[table]]", "## Plan", "new line", "[[image]]"];
    const rewrite = rewrittenDoc(doc, answer);

    expect(rewrite.ok).toBe(true);
    if (!rewrite.ok) return;
    expect(linesOf(rowsOfDoc(rewrite.doc))).toEqual(answer);
    expect(rewrite.doc.content![1]).toEqual(doc.content![10]);
    expect(rewrite.doc.content![2]).toEqual(doc.content![1]);
  });

  test("an answer that dropped the image is not applied, and names the kind", () => {
    expect(rewrittenDoc(doc, ["## Plan", "[[table]]"])).toEqual({ ok: false, kinds: ["image"] });
  });
});

describe("runAt", () => {
  const rows = rowsOfDoc(doc);

  test("a caret covers the row it stands in", () => {
    expect(runAt(rows, rows[1]!.from + 2, rows[1]!.from + 2)).toEqual({ at: 1, count: 1 });
  });

  test("a selection covers every row it reaches", () => {
    const run = runAt(rows, rows[0]!.from + 1, rows[3]!.from + 1)!;

    expect(run).toEqual({ at: 0, count: 4 });
    expect(linesOfRun(rows, run)).toEqual(["## Plan", "see Other", "- milk", "  - oat"]);
  });

  test("the title is no row", () => {
    expect(runAt(rows, 1, 1)).toBeNull();
  });
});

describe("retitledDoc", () => {
  test("the title node holds the new title, the blocks untouched", () => {
    const renamed = retitledDoc(doc, "Month");

    expect(renamed.content![0]).toEqual({ type: "title", content: [text("Month")] });
    expect(renamed.content!.slice(1)).toEqual(doc.content!.slice(1));
  });
});
