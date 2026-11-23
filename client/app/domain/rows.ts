// The note read as the talk's rows and written back from them (`docs/design.md`, 「The talk panel」,
// 「Agent」): the TipTap document's blocks in the order they stand, one row a block — a list item, a to-do
// item and each paragraph of a quote counting as one, a deeper block two spaces further in — each row
// keeping the node it was read from, and the document built again from rows. A row the patch leaves
// untouched is written back as the node it was read from, its marks, note links and comment marks with it;
// a row the patch writes is built from its line as plain words of its kind. Every row knows the place it
// stands in the document, so a selection reads as the rows it covers.
//
// This works on the document's JSON alone: the editor hands its document in and takes the result back as one
// transaction (`domain/document`).

import { planWhole } from "./patch";
import { lineOf, linesOf, rowOf } from "./text";

import type { DocNode } from "../../shared/types";
import type { Op } from "./patch";
import type { Row, RowKind } from "./text";

export type { DocNode };

/** The list a row's item stands in, by its node type, with that list's attributes. */
type ListType = "bulletList" | "orderedList" | "taskList";

/** One block read as a row: its line's kind, text and depth, the node it came from and where it stands. */
export interface DocRow extends Row {
  /** The node the row stands for: the block, or a list item's or a quote's own paragraph. Absent for a row
   * built from a line. */
  node?: DocNode;
  /** The list an item stands in, with its attributes. */
  list?: { type: ListType; attrs?: Record<string, unknown> };
  /** The row's place in the document: its node's start and end positions. */
  from: number;
  to: number;
}

const INLINE = new Set(["text", "mention", "hardBreak"]);
const LEAF_BLOCKS = new Set(["horizontalRule", "image"]);

/** The size a node takes in the document, as the editor counts positions. */
export function nodeSize(node: DocNode): number {
  if (node.type === "text") return (node.text ?? "").length;
  if (INLINE.has(node.type) || LEAF_BLOCKS.has(node.type)) return 1;

  return 2 + (node.content ?? []).reduce((sum, child) => sum + nodeSize(child), 0);
}

/** The words of a block's inline content: its text, a note link's title, a hard break as a line break. */
export function wordsOf(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "mention") return String(node.attrs?.label ?? "");
  if (node.type === "hardBreak") return "\n";

  return (node.content ?? []).map(wordsOf).join("");
}

/** The note's body as rows, the title node set aside. */
export function rowsOfDoc(doc: DocNode): DocRow[] {
  const rows: DocRow[] = [];
  let at = 0;

  for (const node of doc.content ?? []) {
    if (node.type !== "title") walk(node, at, 0, rows);
    at += nodeSize(node);
  }

  return rows;
}

function headingKind(level: unknown): RowKind {
  const clamped = Math.min(6, Math.max(1, Number(level) || 1));

  return `h${clamped}` as RowKind;
}

/** Reads one block standing at `at` into rows. */
function walk(node: DocNode, at: number, indent: number, rows: DocRow[]): void {
  const end = at + nodeSize(node);
  const push = (kind: RowKind, text: string, extra: Partial<DocRow> = {}): void => {
    rows.push({ kind, text, indent, node, from: at, to: end, ...extra });
  };

  switch (node.type) {
    case "paragraph":
      push("text", wordsOf(node));

      return;
    case "heading":
      push(headingKind(node.attrs?.level), wordsOf(node));

      return;
    case "codeBlock":
      push("code", wordsOf(node));

      return;
    case "horizontalRule":
      push("divider", "");

      return;
    case "image":
      push("image", "");

      return;
    case "table":
      push("table", "");

      return;
    case "blockquote": {
      let inner = at + 1;

      for (const child of node.content ?? []) {
        if (child.type === "paragraph") rows.push({ kind: "quote", text: wordsOf(child), indent, node: child, from: inner, to: inner + nodeSize(child) });
        else walk(child, inner, indent, rows);
        inner += nodeSize(child);
      }

      return;
    }
    case "bulletList":
    case "orderedList":
    case "taskList": {
      let item = at + 1;

      for (const entry of node.content ?? []) {
        const [first, ...rest] = entry.content ?? [];
        let inner = item + 1;

        if (first !== undefined) {
          const kind: RowKind =
            node.type === "bulletList" ? "bulleted" : node.type === "orderedList" ? "numbered" : entry.attrs?.checked === true ? "todo-done" : "todo";

          rows.push({
            kind,
            text: wordsOf(first),
            indent,
            node: first,
            list: { type: node.type, attrs: node.attrs },
            from: inner,
            to: inner + nodeSize(first)
          });
          inner += nodeSize(first);
        }

        for (const child of rest) {
          walk(child, inner, indent + 1, rows);
          inner += nodeSize(child);
        }

        item += nodeSize(entry);
      }

      return;
    }
    default: {
      // A block of a kind the line grammar does not name reads as its words, and stands as it stood while
      // its line is untouched.
      push("text", wordsOf(node));
    }
  }
}

/** The inline content a line's words make: the words, a line break as a hard break. */
function inlineOf(text: string): DocNode[] | undefined {
  const nodes: DocNode[] = [];

  text.split("\n").forEach((part, at) => {
    if (at > 0) nodes.push({ type: "hardBreak" });
    if (part !== "") nodes.push({ type: "text", text: part });
  });

  return nodes.length === 0 ? undefined : nodes;
}

function withContent(node: DocNode, content: DocNode[] | undefined): DocNode {
  return content === undefined ? node : { ...node, content };
}

/** The block a row stands for: its own node where it was read from one, else one built from its line. */
function blockOf(row: DocRow): DocNode {
  if (row.node !== undefined && row.kind !== "quote" && row.list === undefined) return row.node;

  const heading = /^h([1-6])$/u.exec(row.kind);

  if (heading !== null) return withContent({ type: "heading", attrs: { level: Number(heading[1]) } }, inlineOf(row.text));
  if (row.kind === "code") return withContent({ type: "codeBlock", attrs: { language: null } }, row.text === "" ? undefined : [{ type: "text", text: row.text }]);
  if (row.kind === "divider") return { type: "horizontalRule" };

  return paragraphOf(row);
}

/** A list item's or a quote's own paragraph: the node it was read from, else one built from its line. */
function paragraphOf(row: DocRow): DocNode {
  if (row.node !== undefined && row.node.type === "paragraph") return row.node;

  return withContent({ type: "paragraph" }, inlineOf(row.text));
}

const LIST_OF: Partial<Record<RowKind, ListType>> = { bulleted: "bulletList", numbered: "orderedList", todo: "taskList", "todo-done": "taskList" };

/** The document built from its title node and rows: list items gathered into their lists, a deeper row nested
 * under the item before it, consecutive quote rows into one quote. */
export function docOfRows(title: DocNode, rows: DocRow[]): DocNode {
  const [blocks] = build(rows, 0, 0);

  return { type: "doc", content: [title, ...(blocks.length > 0 ? blocks : [{ type: "paragraph" }])] };
}

function build(rows: DocRow[], start: number, indent: number): [DocNode[], number] {
  const out: DocNode[] = [];
  let at = start;

  while (at < rows.length && rows[at]!.indent >= indent) {
    const row = rows[at]!;
    const list = LIST_OF[row.kind];

    if (list !== undefined) {
      const items: DocNode[] = [];
      const attrs = row.list?.type === list ? row.list.attrs : undefined;

      while (at < rows.length && rows[at]!.indent === indent && LIST_OF[rows[at]!.kind] === list) {
        const item = rows[at]!;
        const content: DocNode[] = [paragraphOf(item)];

        at += 1;

        if (at < rows.length && rows[at]!.indent > indent) {
          const [nested, next] = build(rows, at, indent + 1);

          content.push(...nested);
          at = next;
        }

        items.push(list === "taskList" ? { type: "taskItem", attrs: { checked: item.kind === "todo-done" }, content } : { type: "listItem", content });
      }

      out.push(attrs === undefined ? { type: list, content: items } : { type: list, attrs, content: items });
      continue;
    }

    if (row.kind === "quote") {
      const paragraphs: DocNode[] = [];

      while (at < rows.length && rows[at]!.indent === indent && rows[at]!.kind === "quote") {
        paragraphs.push(paragraphOf(rows[at]!));
        at += 1;
      }

      out.push({ type: "blockquote", content: paragraphs });
      continue;
    }

    out.push(blockOf(row));
    at += 1;

    // A deeper row under a block that holds none stands after it, at the block's own depth.
    if (at < rows.length && rows[at]!.indent > indent && LIST_OF[rows[at]!.kind] === undefined) {
      const [nested, next] = build(rows, at, indent + 1);

      out.push(...nested);
      at = next;
    }
  }

  return [out, at];
}

/** The title node a document holds, or an empty one. */
export function titleNode(doc: DocNode): DocNode {
  return (doc.content ?? []).find((node) => node.type === "title") ?? { type: "title" };
}

/** A row built from one of the answer's lines: no node of its own. */
function lineRow(line: string): DocRow {
  return { ...rowOf(line), from: -1, to: -1 };
}

/** The document with the patch's runs written in, each at the place it was anchored. A row the runs leave
 * untouched keeps the node it was read from. */
export function patchedDoc(doc: DocNode, ops: Op[]): DocNode {
  const rows = rowsOfDoc(doc);

  for (const op of [...ops].sort((left, right) => right.at - left.at)) {
    if (op.at < 0 || op.at > rows.length || op.at + op.del > rows.length) throw new Error("the patch reaches past the note");

    rows.splice(op.at, op.del, ...op.insert.map(lineRow));
  }

  return docOfRows(titleNode(doc), rows);
}

/** The opaque kinds a whole rewrite could not place, as the panel names them. */
export type OpaqueKind = "image" | "table";

/** A whole rewrite: the document it makes, or the kinds that stand in its way. */
export type Rewrite = { ok: true; doc: DocNode } | { ok: false; kinds: OpaqueKind[] };

/** The document with its whole body written from the answer, its images and tables moved whole into the
 * places the answer's marker lines draw (`patch`'s `planWhole`), and every line the note already holds word
 * for word kept as the node it was. */
export function rewrittenDoc(doc: DocNode, lines: string[]): Rewrite {
  const current = rowsOfDoc(doc);
  const base = linesOf(current);
  const plan = planWhole(base, lines);

  if (!("places" in plan)) return { ok: false, kinds: unplacedKinds(base, lines) };

  const unused = current.map((_, at) => at);
  const rows = lines.map((line): DocRow => {
    const kept = unused.findIndex((at) => lineOf(current[at]!) === line);

    if (kept < 0) return lineRow(line);

    const [at] = unused.splice(kept, 1);

    return current[at!]!;
  });

  for (const place of plan.places) rows[place.into] = current[place.at]!;

  return { ok: true, doc: docOfRows(titleNode(doc), rows) };
}

/** The opaque kinds whose markers do not pair one for one, at the same depths, between the two line lists. */
function unplacedKinds(base: string[], next: string[]): OpaqueKind[] {
  const kinds: OpaqueKind[] = [];

  for (const kind of ["image", "table"] as const) {
    const read = (lines: string[]): string => lines.map(rowOf).filter((row) => row.kind === kind).map((row) => row.indent).join(",");

    if (read(base) !== read(next)) kinds.push(kind);
  }

  return kinds;
}

/** The document with its title node holding `title`. */
export function retitledDoc(doc: DocNode, title: string): DocNode {
  const node: DocNode = title === "" ? { type: "title" } : { type: "title", content: [{ type: "text", text: title }] };
  const content = doc.content ?? [];
  const at = content.findIndex((one) => one.type === "title");

  return { ...doc, content: at < 0 ? [node, ...content] : content.map((one, index) => (index === at ? node : one)) };
}

/** The rows a selection between `from` and `to` covers, as a run: where it starts and how many it holds. A
 * caret covers the row whose words it stands in; a selection reaching no row covers none. */
export function runAt(rows: DocRow[], from: number, to: number): { at: number; count: number } | null {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const covered = rows.map((row, at) => ({ row, at })).filter(({ row }) => row.from < high && row.to > low);

  if (covered.length === 0) return null;

  // A row nested in a covered row stands inside it; the run reaches from the first to the last.
  const first = covered[0]!.at;
  const last = covered[covered.length - 1]!.at;

  return { at: first, count: last - first + 1 };
}

/** The runs of rows read as lines, as the ask sends a passage. */
export function linesOfRun(rows: DocRow[], run: { at: number; count: number }): string[] {
  return linesOf(rows.slice(run.at, run.at + run.count));
}
