// The patch's hand on the open editor (`docs/design.md`, 「The AI talk panel」): the note read as the
// lines the talk asks over, and the changed runs written back as blocks. A run is replaced whole, so
// nothing outside it is rebuilt: another line's inline marks, an image and a table all stand where
// the owner left them. The note container is the one the editor seeds; the blocks under it are the
// note's body.

import { Text } from "@blocksuite/affine/store";

import { opaqueRow, rowOf } from "./text";

import type { BlockModel, Store } from "@blocksuite/affine/store";
import type { Op } from "./patch";
import type { Row, RowKind } from "./text";

const NOTE = "affine:note";

/** One block of the note read as the line it wears. */
export interface LiveRow extends Row {
  model: BlockModel;
}

/** The note's body as lines, in the order the blocks stand, each deeper block two spaces further in. */
export function readRows(store: Store): LiveRow[] {
  const note = noteOf(store);
  const rows: LiveRow[] = [];

  if (note !== null) walk(store, note, 0, rows);

  return rows;
}

/** Writes the plan's runs into the document, at the place each run was anchored. */
export function applyOps(store: Store, ops: Op[]): void {
  for (const op of [...ops].sort((left, right) => right.at - left.at)) applyOne(store, op);

  ensureBody(store);
}

/**
 * Writes the whole body from the answer outright, the panel's fallback when the anchored patch cannot
 * land. An image or a table is not recreated from a line, so a note holding one keeps its text rather
 * than lose it: the screen offers the fallback only where the body is plain lines.
 */
export function replaceBody(store: Store, lines: string[]): boolean {
  const rows = readRows(store);

  if (rows.some(opaqueRow)) return false;

  applyOps(store, [{ at: 0, del: rows.length, insert: lines }]);

  return true;
}

function applyOne(store: Store, op: Op): void {
  const rows = readRows(store);
  const at = clamp(op.at, 0, rows.length);
  const until = clamp(at + Math.max(0, op.del), at, rows.length);
  const replaced = rows.slice(at, until);

  // Descendants go before their parent, so a deleted run leaves nothing of itself behind. A child the
  // run did not name is handed to the parent instead of going with it.
  for (const row of [...replaced].reverse()) {
    const parent = store.getParent(row.model);

    if (parent === null) store.deleteBlock(row.model);
    else store.deleteBlock(row.model, { bringChildrenTo: parent, deleteChildren: false });
  }

  const after = readRows(store);
  const insert = op.insert.map(rowOf);
  const spot = place(store, after, Math.min(at, after.length), insert);

  insertRows(store, spot.parent, spot.index, insert);
}

/** Where an inserted run goes: the parent and the index among its children. */
function place(store: Store, rows: LiveRow[], at: number, insert: Row[]): { parent: BlockModel; index: number } {
  const note = noteOf(store);

  if (note === null) throw new Error("the note holds no note container");

  const depth = Math.max(0, insert[0]?.indent ?? 0);
  const next = rows[at] ?? null;

  if (next !== null) {
    if (next.indent === depth) return spotOf(store, next.model, note);
    if (next.indent > depth) {
      const ancestor = climb(store, next.model, depth);

      if (ancestor !== null) return spotOf(store, ancestor, note);
    }
  }

  // A run deeper than the line it stands before belongs under the line before it.
  const prev = at > 0 ? (rows[at - 1] ?? null) : null;
  const holder = depth === 0 ? null : climb(store, prev?.model ?? null, depth - 1);

  if (holder !== null && canParent(holder)) return { parent: holder, index: holder.children.length };

  return { parent: note, index: note.children.length };
}

function spotOf(store: Store, model: BlockModel, note: BlockModel): { parent: BlockModel; index: number } {
  const parent = store.getParent(model);

  if (parent === null) return { parent: note, index: note.children.length };

  return { parent, index: parent.children.indexOf(model) };
}

/** The ancestor of a block standing at the given depth, or the block itself where it already stands there. */
function climb(store: Store, model: BlockModel | null, depth: number): BlockModel | null {
  let node = model;

  while (node !== null && depthOf(store, node) > depth) node = store.getParent(node);

  return node !== null && depthOf(store, node) === depth ? node : null;
}

function insertRows(store: Store, parent: BlockModel, index: number, rows: Row[]): void {
  if (rows.length === 0) return;

  const base = Math.max(0, rows[0]?.indent ?? 0);
  const places = new Map<BlockModel, number>([[parent, index]]);
  const stack: Array<BlockModel | undefined> = [];

  rows.forEach((row, at) => {
    let depth = Math.max(base, Math.max(0, row.indent));
    let holder = parent;

    if (at > 0 && depth > base) {
      let up = depth - 1;

      while (up >= base && !(stack[up] !== undefined && canParent(stack[up]!))) up -= 1;

      if (up >= base) {
        holder = stack[up]!;
        depth = up + 1;
      } else depth = base;
    }

    const flavour = flavourOf(row);

    if (flavour === null) return;

    const indexAt = places.get(holder) ?? holder.children.length;
    const id = store.addBlock(flavour, propsOf(row) as never, holder, indexAt);
    const model = store.getBlock(id)?.model;

    if (model !== undefined) {
      places.set(holder, indexAt + 1);
      stack.length = depth + 1;
      stack[depth] = model;
    }
  });
}

/** A note whose body emptied keeps one paragraph, so the reader has somewhere to stand. */
function ensureBody(store: Store): void {
  const note = noteOf(store);

  if (note !== null && note.children.length === 0) store.addBlock("affine:paragraph", {}, note);
}

function noteOf(store: Store): BlockModel | null {
  const root = store.root;

  if (root === null) return null;

  return root.children.find((child) => child.flavour === NOTE) ?? null;
}

function depthOf(store: Store, model: BlockModel): number {
  let depth = 0;
  let parent = store.getParent(model);

  while (parent !== null && parent.flavour !== NOTE) {
    depth += 1;
    parent = store.getParent(parent);
  }

  return depth;
}

function walk(store: Store, parent: BlockModel, depth: number, rows: LiveRow[]): void {
  for (const model of parent.children) {
    const row = rowOfModel(model);

    if (row === null) continue;

    rows.push({ ...row, indent: depth, model });

    if (carries(row.kind)) walk(store, model, depth + 1, rows);
  }
}

/** The block kinds that can hold the note's own blocks under them. */
function carries(kind: RowKind): boolean {
  return kind === "text" || kind === "h1" || kind === "h2" || kind === "h3" || kind === "quote" || kind === "bulleted" || kind === "numbered" || kind === "todo" || kind === "todo-done";
}

function rowOfModel(model: BlockModel): Row | null {
  const text = model.text?.toString() ?? "";
  const type = String((model.props as { type?: unknown }).type ?? "");

  switch (model.flavour) {
    case "affine:paragraph":
      if (type === "h1" || type === "h2" || type === "h3") return { kind: type, text, indent: 0 };
      if (type === "quote") return { kind: "quote", text, indent: 0 };
      return { kind: "text", text, indent: 0 };
    case "affine:list":
      if (type === "numbered") return { kind: "numbered", text, indent: 0 };
      if (type === "todo") {
        const checked = (model.props as { checked?: unknown }).checked === true;

        return { kind: checked ? "todo-done" : "todo", text, indent: 0 };
      }
      return { kind: "bulleted", text, indent: 0 };
    case "affine:code":
      return { kind: "code", text, indent: 0 };
    case "affine:divider":
      return { kind: "divider", text: "", indent: 0 };
    case "affine:image":
      return { kind: "image", text: "", indent: 0 };
    case "affine:table":
      return { kind: "table", text: "", indent: 0 };
    default:
      // A block the line grammar has no kind for stands opaque: a patch that would move it fails
      // whole rather than rewrite the block as a paragraph it never was.
      return { kind: "table", text: "", indent: 0 };
  }
}

function canParent(model: BlockModel): boolean {
  return model.flavour === "affine:paragraph" || model.flavour === "affine:list" || model.flavour === "affine:callout";
}

/** The flavour a row stands as, or null where no block is written for it. */
function flavourOf(row: Row): string | null {
  switch (row.kind) {
    case "text":
    case "h1":
    case "h2":
    case "h3":
    case "quote":
      return "affine:paragraph";
    case "bulleted":
    case "numbered":
    case "todo":
    case "todo-done":
      return "affine:list";
    case "code":
      return "affine:code";
    case "divider":
      return "affine:divider";
    case "image":
    case "table":
      return null;
  }
}

function propsOf(row: Row): Record<string, unknown> {
  switch (row.kind) {
    case "text":
      return { type: "text", text: new Text(row.text) };
    case "h1":
    case "h2":
    case "h3":
    case "quote":
      return { type: row.kind, text: new Text(row.text) };
    case "bulleted":
    case "numbered":
      return { type: row.kind, text: new Text(row.text) };
    case "todo":
      return { type: "todo", checked: false, text: new Text(row.text) };
    case "todo-done":
      return { type: "todo", checked: true, text: new Text(row.text) };
    case "code":
      return { text: new Text(row.text), language: null };
    default:
      return {};
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
