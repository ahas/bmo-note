// The note editor's schema beyond what Nuxt UI's editor brings (`docs/design.md`, 「What a note is」): the
// document holding one title node first, the title node itself, the comment mark, the note link, the image
// named by its stored blob, to-do lists and tables, and the block id every block carries. Nuxt UI's editor
// lays the starter kit — paragraphs, headings, lists, quotes, code, dividers, hard breaks and the inline
// marks — and these stand beside it.

import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { BlockIds } from "./blocks";

import type { AnyExtension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";

/** The document: one title node, then the note's blocks. */
export const NoteDocument = Node.create({
  name: "doc",
  topNode: true,
  content: "title block+"
});

/** The title node: plain words, no marks, drawn large as the page's own heading. Enter in it carries the caret
 * to the first block, as a reader expects of a title. */
export const NoteTitle = Node.create({
  name: "title",
  content: "text*",
  marks: "",
  defining: true,

  parseHTML() {
    return [{ tag: "h1[data-note-title]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["h1", mergeAttributes(HTMLAttributes, { "data-note-title": "" }), 0];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;

        if ($from.parent.type.name !== this.name) return false;

        const after = $from.after(1);

        return editor
          .chain()
          .command(({ tr }) => {
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after + 1, tr.doc.content.size))));

            return true;
          })
          .scrollIntoView()
          .run();
      }
    };
  }
});

/** The comment mark: the words a thread is laid on, carrying the thread's id. Marks of several threads may
 * overlap, and words typed at a mark's edge do not take it. */
export const CommentMark = Mark.create({
  name: "comment",
  excludes: "",
  inclusive: false,

  addAttributes() {
    return {
      thread: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-thread"),
        renderHTML: (attributes: { thread?: string | null }) => (attributes.thread ? { "data-thread": attributes.thread } : {})
      }
    };
  },

  parseHTML() {
    return [{ tag: "span[data-thread]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "note-comment" }), 0];
  }
});

/** Which threads' words wear the comment tint, and the one standing open under its line. */
export interface Tinted {
  open: readonly string[];
  chosen: string | null;
}

export const COMMENT_TINT = new PluginKey<{ tinted: Tinted; decorations: DecorationSet }>("noteCommentTint");

function tintOf(doc: ProseNode, tinted: Tinted): DecorationSet {
  const open = new Set(tinted.open);
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      const thread = mark.type.name === "comment" ? String(mark.attrs.thread ?? "") : "";

      if (thread !== "" && thread === tinted.chosen) {
        decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: open.has(thread) ? "note-comment-open note-comment-chosen" : "note-comment-chosen" }));
      } else if (thread !== "" && open.has(thread)) {
        decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: "note-comment-open" }));
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

/** The comment tint: the words of an open thread wear it, those of the thread standing open under its line more
 * strongly, resolved or not, and a resolved thread's words none otherwise. The screen hands the open threads in
 * with a transaction's `COMMENT_TINT` meta. */
export const CommentTint = Extension.create({
  name: "commentTint",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: COMMENT_TINT,
        state: {
          init: (_config, state) => {
            const tinted: Tinted = { open: [], chosen: null };

            return { tinted, decorations: tintOf(state.doc, tinted) };
          },
          apply: (transaction, held) => {
            const given = transaction.getMeta(COMMENT_TINT) as Tinted | undefined;
            const tinted = given ?? held.tinted;

            if (given === undefined && !transaction.docChanged) return held;

            return { tinted, decorations: tintOf(transaction.doc, tinted) };
          }
        },
        props: {
          decorations: (state) => COMMENT_TINT.getState(state)?.decorations ?? DecorationSet.empty
        }
      })
    ];
  }
});

/** What the comment gap opens under: a new thread's words, by the range they stand in, or a thread's words. */
export type GapTarget = { draft: { from: number; to: number } } | { thread: string } | null;

export const COMMENT_GAP = new PluginKey<{ target: GapTarget; decorations: DecorationSet }>("noteCommentGap");

/** The place under the words ending at `end`: after the line holding them, or after the table they stand in, so a
 * gap never opens inside a cell. A place between blocks stands as it is. */
export function gapAfter(doc: ProseNode, end: number): number {
  const at = doc.resolve(Math.min(Math.max(end, 0), doc.content.size));

  for (let depth = 1; depth <= at.depth; depth += 1) {
    if (at.node(depth).type.name === "table") return at.after(depth);
  }

  let depth = at.depth;

  while (depth > 0 && !at.node(depth).isTextblock) depth -= 1;

  return depth === 0 ? at.pos : at.after(depth);
}

/** Where a thread's words end in the document; null where none of them stands. */
export function threadEnd(doc: ProseNode, thread: string): number | null {
  let end: number | null = null;

  doc.descendants((node, pos) => {
    if (node.marks.some((mark) => mark.type.name === "comment" && mark.attrs.thread === thread)) end = pos + node.nodeSize;
  });

  return end;
}

/** The place the gap opens at for `target`: under a draft's words, the last of them taken where the range ends at
 * the start of the next line; under a thread's words; at the document's end for a thread whose words were
 * deleted. */
export function gapPlace(doc: ProseNode, target: Exclude<GapTarget, null>): number {
  if ("draft" in target) {
    const { from, to } = target.draft;

    return gapAfter(doc, to > from ? to - 1 : to);
  }

  const end = threadEnd(doc, target.thread);

  return end === null ? doc.content.size : gapAfter(doc, Math.max(0, end - 1));
}

function gapOf(doc: ProseNode, target: GapTarget, place: HTMLElement): DecorationSet {
  if (target === null) return DecorationSet.empty;

  const decorations = [
    Decoration.widget(gapPlace(doc, target), place, { side: 1, key: "note-comment-gap", stopEvent: () => true, ignoreSelection: true })
  ];

  if ("draft" in target && target.draft.to > target.draft.from) {
    decorations.push(Decoration.inline(target.draft.from, target.draft.to, { class: "note-comment-chosen" }));
  }

  return DecorationSet.create(doc, decorations);
}

/** The comment gap (`docs/design.md`, 「Comments」): the lines part under the words a comment is laid on and the
 * screen's form or thread stands in the space between them, in the flow of the document. The place is one element
 * the screen draws into; a new thread's words wear the chosen tint while its form stands, and its range follows
 * the edits made around it. The screen opens and closes the gap with a transaction's `COMMENT_GAP` meta. */
export function commentGap(place: HTMLElement) {
  place.contentEditable = "false";
  place.dataset.commentGap = "";

  return Extension.create({
    name: "commentGap",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: COMMENT_GAP,
          state: {
            init: () => ({ target: null as GapTarget, decorations: DecorationSet.empty }),
            apply: (transaction, held) => {
              const given = transaction.getMeta(COMMENT_GAP) as { target: GapTarget } | undefined;
              let target = given === undefined ? held.target : given.target;

              if (given === undefined && !transaction.docChanged) return held;

              if (given === undefined && target !== null && "draft" in target) {
                const from = transaction.mapping.map(target.draft.from, 1);

                target = { draft: { from, to: Math.max(from, transaction.mapping.map(target.draft.to, -1)) } };
              }

              return { target, decorations: gapOf(transaction.doc, target, place) };
            }
          },
          props: {
            decorations: (state) => COMMENT_GAP.getState(state)?.decorations ?? DecorationSet.empty
          }
        })
      ];
    }
  });
}

/** Where a note link leads, as the screen answers it: the address the link's anchor carries. */
export type NoteLinkHref = (target: { id: string; owner: string }) => string;

/** The note link: the editor's mention node naming the linked note by its id and its owner's key, with the
 * title it bore when it was linked, drawn as that title in the link tone with the note mark before it. */
export function noteLink(href: NoteLinkHref, untitled: string) {
  return Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        owner: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-owner"),
          renderHTML: (attributes: { owner?: string | null }) => (attributes.owner ? { "data-owner": attributes.owner } : {})
        }
      };
    },

    renderHTML({ node, HTMLAttributes }) {
      const label = String(node.attrs.label ?? "").trim() || untitled;

      return [
        "a",
        mergeAttributes(HTMLAttributes, {
          href: href({ id: String(node.attrs.id ?? ""), owner: String(node.attrs.owner ?? "") }),
          class: "note-link",
          "data-note-link": node.attrs.id
        }),
        ["span", { class: "note-link-mark", "aria-hidden": "true" }],
        label
      ];
    },

    renderText({ node }) {
      return String(node.attrs.label ?? "");
    }
  }).configure({
    // The menus that put links in are the screen's own (Nuxt UI's mention menus), so the node brings none.
    suggestions: [],
    deleteTriggerWithBackspace: true
  });
}

/** Where an image's bytes are read, by its blob id. */
export type ImageAddress = (blobId: string) => string;

/** An image named by its stored blob: the address it is drawn from is the screen's to answer, so the same
 * document reads its images through the note's route or a share link's. */
export function noteImage(address: ImageAddress) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        blob: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute("data-blob"),
          renderHTML: (attributes: { blob?: string | null }) => (attributes.blob ? { "data-blob": attributes.blob, src: address(attributes.blob) } : {})
        }
      };
    }
  }).configure({ allowBase64: false });
}

/** Everything the note editor lays beside Nuxt UI's editor. */
export function noteExtensions(options: { href: NoteLinkHref; untitled: string; image: ImageAddress; gap?: HTMLElement }): AnyExtension[] {
  return [
    NoteDocument,
    NoteTitle,
    CommentMark,
    CommentTint,
    ...(options.gap === undefined ? [] : [commentGap(options.gap)]),
    noteLink(options.href, options.untitled),
    noteImage(options.image),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    BlockIds
  ];
}
