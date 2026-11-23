// The block ids of a note's document (`docs/design.md`, 「What a note is」, 「Bookmarks」): every block carries
// one in its `block` attribute, given as the block is written and kept while its words change and while it is
// moved, so a line bookmark anchored to it follows the block. A block written before the ids were kept takes one
// the first time its note is edited; opening a note writes nothing.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import type { Node as ProseNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/** The kinds of block that carry an id: every block a line of the note stands for, and the lists around them. */
export const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "codeBlock", "horizontalRule", "image", "table", "bulletList", "orderedList", "taskList", "listItem", "taskItem"];

/** The attribute a block's id stands in, in the document's JSON and on the drawn block. */
export const BLOCK_ATTR = "block";
export const BLOCK_DATA = "data-block";

/** A fresh block id: letters, digits and `-`, as the service's id rules allow. */
export function freshBlockId(): string {
  return crypto.randomUUID();
}

/** The blocks of a document that need an id written: those holding none, and every one after the first that
 * repeats an id, as a copy pasted or duplicated does. Each is its position and the id it takes. */
export function blocksToMark(doc: ProseNode, fresh: () => string = freshBlockId): [number, string][] {
  const seen = new Set<string>();
  const marked: [number, string][] = [];

  doc.descendants((node, pos) => {
    if (!BLOCK_TYPES.includes(node.type.name)) return true;

    const id = node.attrs[BLOCK_ATTR] as string | null | undefined;

    if (typeof id === "string" && id !== "" && !seen.has(id)) {
      seen.add(id);
    } else {
      const given = fresh();

      seen.add(given);
      marked.push([pos, given]);
    }

    return true;
  });

  return marked;
}

/** The transaction that writes the ids `blocksToMark` names, or null where none is needed. */
export function markBlocks(state: EditorState, fresh: () => string = freshBlockId): Transaction | null {
  const marked = blocksToMark(state.doc, fresh);

  if (marked.length === 0) return null;

  const tr = state.tr;

  for (const [pos, id] of marked) tr.setNodeAttribute(pos, BLOCK_ATTR, id);

  return tr;
}

/** The id of the block at `pos`, where a block of the kinds that carry one stands there and holds one. */
export function blockIdAt(doc: ProseNode, pos: number): string | null {
  const node = doc.nodeAt(pos);
  const id = node?.attrs[BLOCK_ATTR];

  return node !== null && node !== undefined && BLOCK_TYPES.includes(node.type.name) && typeof id === "string" && id !== "" ? id : null;
}

/** The position of the innermost block holding the caret at `pos`, of the kinds that carry an id. */
export function blockAround(doc: ProseNode, pos: number): number | null {
  const $pos = doc.resolve(Math.min(pos, doc.content.size));

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (BLOCK_TYPES.includes($pos.node(depth).type.name)) return $pos.before(depth);
  }

  return null;
}

/** The words a block holds, on one line, as a line bookmark names it. */
export function blockWords(node: ProseNode, max = 300): string {
  return node.textBetween(0, node.content.size, " ", " ").split(/\s+/u).filter((part) => part !== "").join(" ").slice(0, max);
}

const BLOCK_IDS = new PluginKey("noteBlockIds");

/** The block standing marked a moment, as a line opened from its bookmark is: its id, or null. The mark is a
 * decoration of the editor's own, so the editor never draws over it. */
export const LINE_SHOWN = new PluginKey<string | null>("noteLineShown");

/** The class the marked block wears. */
export const LINE_SHOWN_CLASS = "note-line-shown";

/** Where the block of id `block` stands, or null. */
export function blockPos(doc: ProseNode, block: string): number | null {
  let found: number | null = null;

  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (BLOCK_TYPES.includes(node.type.name) && node.attrs[BLOCK_ATTR] === block) found = pos;

    return found === null;
  });

  return found;
}

/** The `block` attribute on every kind that carries one, and the plugin that writes an id onto each block an
 * edit leaves without one. An edit that sets content without an update — the document read as the note opens —
 * writes none. */
export const BlockIds = Extension.create({
  name: "noteBlockIds",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          [BLOCK_ATTR]: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => element.getAttribute(BLOCK_DATA),
            renderHTML: (attributes: Record<string, unknown>) => (typeof attributes[BLOCK_ATTR] === "string" ? { [BLOCK_DATA]: attributes[BLOCK_ATTR] } : {})
          }
        }
      }
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: BLOCK_IDS,
        appendTransaction: (transactions, _before, state) => {
          const edited = transactions.some((tr) => tr.docChanged && tr.getMeta("preventUpdate") !== true);

          return edited ? markBlocks(state) : null;
        }
      }),
      new Plugin<string | null>({
        key: LINE_SHOWN,
        state: {
          init: () => null,
          apply: (tr, shown) => {
            const asked = tr.getMeta(LINE_SHOWN) as string | null | undefined;

            return asked === undefined ? shown : asked;
          }
        },
        props: {
          decorations: (state) => {
            const shown = LINE_SHOWN.getState(state) ?? null;
            const pos = shown === null ? null : blockPos(state.doc, shown);
            const node = pos === null ? null : state.doc.nodeAt(pos);

            return pos === null || node === null ? null : DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: LINE_SHOWN_CLASS })]);
          }
        }
      })
    ];
  }
});
