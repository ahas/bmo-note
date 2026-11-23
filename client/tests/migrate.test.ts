import { describe, expect, test } from "bun:test";

import { comparable, convertSnapshot, documentWords, snapshotWords } from "../scripts/migrate/convert";

import type { SnapshotBlock } from "../scripts/migrate/convert";

// The migration's conversion (`docs/design.md`, 「What a note is」): a BlockSuite snapshot, as the earlier
// editor's transformer reads one, written as the note editor's TipTap document, every word kept.

const text = (...ops: Array<string | [string, Record<string, unknown>]>) => ({
  "$blocksuite:internal:text$": true,
  delta: ops.map((op) => (typeof op === "string" ? { insert: op } : { insert: op[0], attributes: op[1] }))
});

const block = (flavour: string, props: Record<string, unknown>, children: SnapshotBlock[] = []): SnapshotBlock => ({ flavour, props, children });

const page: SnapshotBlock = block("affine:page", { title: text("Quarter ", "plan") }, [
  block("affine:surface", {}),
  block("affine:note", {}, [
    block("affine:paragraph", { type: "h2", text: text("Goals") }),
    block("affine:paragraph", { type: "text", text: text(["bold", { bold: true }], " and ", ["site", { link: "https://example.com" }], " see ", ["Other", { reference: { pageId: "n2" } }], "\nnext") }),
    block("affine:list", { type: "numbered", order: 3, text: text("three") }, [block("affine:list", { type: "bulleted", text: text("under") })]),
    block("affine:list", { type: "numbered", text: text("four") }),
    block("affine:list", { type: "todo", checked: true, text: text("done") }),
    block("affine:paragraph", { type: "quote", text: text("said") }),
    block("affine:code", { language: "rust", text: text("let a = 1;\nlet b = 2;") }),
    block("affine:divider", {}),
    block("affine:image", { sourceId: "digest=", caption: "" }),
    block("affine:table", {
      rows: { r2: { rowId: "r2", order: "a2" }, r1: { rowId: "r1", order: "a1" } },
      columns: { c1: { columnId: "c1", order: "a1" } },
      cells: { "r1:c1": { text: text("top") }, "r2:c1": { text: text("bottom") } }
    }),
    block("affine:database", { title: text(), views: [], columns: [], cells: {} })
  ])
]);

describe("convertSnapshot", () => {
  const { doc, notes } = convertSnapshot(page, { owner: "7" });
  const content = doc.content ?? [];

  test("the title becomes the title node and each block its node", () => {
    expect(content[0]).toEqual({ type: "title", content: [{ type: "text", text: "Quarter plan" }] });
    expect(content.map((node) => node.type)).toEqual(["title", "heading", "paragraph", "orderedList", "taskList", "blockquote", "codeBlock", "horizontalRule", "image", "table"]);
    expect(content[1]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Goals" }] });
  });

  test("marks, links, a link to a page and a line break carry over", () => {
    expect(content[2]?.content).toEqual([
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
      { type: "text", text: " and " },
      { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      { type: "text", text: " see " },
      { type: "mention", attrs: { id: "n2", owner: "7", label: "Other" } },
      { type: "hardBreak" },
      { type: "text", text: "next" }
    ]);
  });

  test("a numbered run keeps its start and its nested items; a to-do keeps its check", () => {
    const list = content[3]!;

    expect(list.attrs).toEqual({ start: 3 });
    expect(list.content?.length).toBe(2);
    expect(list.content?.[0]?.content?.[1]?.type).toBe("bulletList");
    expect(content[4]?.content?.[0]?.attrs).toEqual({ checked: true });
  });

  test("code keeps its language and lines, an image its stored file, a table its rows in order", () => {
    expect(content[6]).toEqual({ type: "codeBlock", attrs: { language: "rust" }, content: [{ type: "text", text: "let a = 1;\nlet b = 2;" }] });
    expect(content[8]).toEqual({ type: "image", attrs: { blob: "digest=", alt: null } });
    expect(documentWords(content[9]!)).toBe("topbottom");
  });

  test("every word stands after the conversion, and an empty database is named as left out", () => {
    expect(comparable(documentWords(doc))).toBe(comparable(snapshotWords(page)));
    expect(notes).toEqual(["empty database left out"]);
  });

  test("an empty page still holds a block for the caret", () => {
    const empty = convertSnapshot(block("affine:page", { title: text() }, [block("affine:note", {})]), { owner: "1" });

    expect(empty.doc).toEqual({ type: "doc", content: [{ type: "title" }, { type: "paragraph" }] });
  });
});
