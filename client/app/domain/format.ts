// The kinds a block turns into and the marks words take (`docs/design.md`, 「The console surface」): the one
// list the format bar's select, the slash menu and the drag handle's menu all read, each kind turned through
// the editor's own commands, so every road to a kind is one mechanism.

import type { ChainedCommands, Editor } from "@tiptap/core";

/** A kind a block can be turned into: its id, which names its words (`note.kind.<id>`), and its icon. */
export interface Kind {
  id: KindId;
  icon: string;
}

export type KindId = "text" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "bulleted" | "numbered" | "todo" | "quote" | "code";

export const KINDS: Kind[] = [
  { id: "text", icon: "i-material-symbols-text-fields" },
  { id: "h1", icon: "i-material-symbols-format-h1" },
  { id: "h2", icon: "i-material-symbols-format-h2" },
  { id: "h3", icon: "i-material-symbols-format-h3" },
  { id: "h4", icon: "i-material-symbols-format-h4" },
  { id: "h5", icon: "i-material-symbols-format-h5" },
  { id: "h6", icon: "i-material-symbols-format-h6" },
  { id: "bulleted", icon: "i-material-symbols-format-list-bulleted" },
  { id: "numbered", icon: "i-material-symbols-format-list-numbered" },
  { id: "todo", icon: "i-material-symbols-checklist" },
  { id: "quote", icon: "i-material-symbols-format-quote" },
  { id: "code", icon: "i-material-symbols-code-blocks-outline" }
];

/** The kinds the format bar's select offers, in its order: the three first headings stand there. */
export const BAR_KINDS: Kind[] = KINDS.filter((kind) => !["h4", "h5", "h6"].includes(kind.id));

/** What the slash menu puts in beside the kinds: a divider, a table and an image. */
export type InsertId = "divider" | "table" | "image";

export const INSERTS: Array<{ id: InsertId; icon: string }> = [
  { id: "divider", icon: "i-material-symbols-horizontal-rule" },
  { id: "table", icon: "i-material-symbols-grid-view" },
  { id: "image", icon: "i-material-symbols-add-photo-alternate" }
];

/** The marks the bars carry, in their order. */
export const MARKS = [
  { id: "bold", icon: "i-material-symbols-format-bold" },
  { id: "italic", icon: "i-material-symbols-format-italic" },
  { id: "underline", icon: "i-material-symbols-format-underlined" },
  { id: "strike", icon: "i-material-symbols-format-strikethrough" },
  { id: "code", icon: "i-material-symbols-code" }
] as const;

export type MarkId = (typeof MARKS)[number]["id"];

/** The chain turning the block under the selection into `kind`: what it stands in is lifted off first — a
 * list, a quote, a code block — so every kind is reached from every other in one step. */
export function turnInto(chain: ChainedCommands, kind: KindId): ChainedCommands {
  const plain = chain.clearNodes();
  const heading = /^h([1-6])$/u.exec(kind);

  if (heading !== null) return plain.setHeading({ level: Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6 });

  switch (kind) {
    case "bulleted":
      return plain.toggleBulletList();
    case "numbered":
      return plain.toggleOrderedList();
    case "todo":
      return plain.toggleTaskList();
    case "quote":
      return plain.toggleBlockquote();
    case "code":
      return plain.setCodeBlock();
    default:
      return plain.setParagraph();
  }
}

/** The chain putting `insert` in at the selection: a divider, or a table of three rows and three columns. The
 * image is the screen's own, since its bytes go to the service first. */
export function insertInto(chain: ChainedCommands, insert: Exclude<InsertId, "image">): ChainedCommands {
  return insert === "divider" ? chain.setHorizontalRule() : chain.insertTable({ rows: 3, cols: 3, withHeaderRow: false });
}

/** The kind the block under the selection stands in, the innermost first; null where none of the kinds is. */
export function activeKind(editor: Pick<Editor, "isActive">): KindId | null {
  if (editor.isActive("codeBlock")) return "code";
  if (editor.isActive("taskList")) return "todo";
  if (editor.isActive("orderedList")) return "numbered";
  if (editor.isActive("bulletList")) return "bulleted";
  if (editor.isActive("blockquote")) return "quote";

  for (const level of [1, 2, 3, 4, 5, 6]) {
    if (editor.isActive("heading", { level })) return `h${level}` as KindId;
  }

  return editor.isActive("paragraph") ? "text" : null;
}

/** The marks the selection's words wear, in the bars' order. */
export function activeMarks(editor: Pick<Editor, "isActive">): boolean[] {
  return MARKS.map((mark) => editor.isActive(mark.id));
}
