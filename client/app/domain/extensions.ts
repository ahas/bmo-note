// The note editor's schema beyond what Nuxt UI's editor brings (`docs/design.md`, 「What a note is」): the
// document holding one title node first, the title node itself, the comment mark, the note link, the image
// named by its stored blob, to-do lists and tables. Nuxt UI's editor lays the starter kit — paragraphs,
// headings, lists, quotes, code, dividers, hard breaks and the inline marks — and these stand beside it.

import { Extension, Mark, Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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

/** Which threads' words wear the comment tint, and the one standing chosen in the panel. */
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

      if (thread !== "" && open.has(thread)) {
        decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: thread === tinted.chosen ? "note-comment-open note-comment-chosen" : "note-comment-open" }));
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

/** The comment tint: the words of an open thread wear it, those of the thread chosen in the panel more
 * strongly, and a resolved thread's words none. The screen hands the open threads in with a transaction's
 * `COMMENT_TINT` meta. */
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
export function noteExtensions(options: { href: NoteLinkHref; untitled: string; image: ImageAddress }): AnyExtension[] {
  return [
    NoteDocument,
    NoteTitle,
    CommentMark,
    CommentTint,
    noteLink(options.href, options.untitled),
    noteImage(options.image),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } })
  ];
}
