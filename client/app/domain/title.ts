// The title a note stands under in the list (`docs/design.md`, 「What a note is」): the document's
// own title where it carries one, else the first line of its content, as the reader sees the note in
// the editor. It walks the same open document the count of `count.ts` walks, on types alone. The talk
// writes the title too, when its answer renames the note; the words it gives are trimmed and capped to
// what the service stores, and the document's own title field is rewritten whole.

/// The longest title the service stores (the store's `clean_title` cap, mirrored as the byte cap is).
export const TITLE_MAX = 300;

/// One node of the walked document, seen only as a title source.
export interface Titlable {
  title?: unknown;
  props?: { title?: unknown; title$?: unknown };
  text?: unknown;
  children?: Titlable[];
}

/// A block text read whole, in whichever shape the fork hands it (a plain `Y.Text`, a wrapper
/// holding one, or the string a reactive field answers with).
function readText(value: unknown): string {
  const holder = value as { yText?: { toString: () => string }; toString?: () => string } | null | undefined;

  return holder?.yText?.toString() ?? holder?.toString?.() ?? "";
}

/// The title the list must show for this document: the root's own title where it stands, else the
/// first line of content carrying any.
export function noteTitle(root: Titlable | null): string {
  // The page title rides the root block's reactive field: the `title$` slot holds the text itself,
  // the plain `title` one the shape the fork of this moment hands, and an older document may carry
  // it at either end still.
  const own = readText(root?.props?.title$ ?? root?.props?.title ?? root?.title).trim();

  if (own !== "") return own;

  const line = (value: unknown): string => {
    const first =
      readText(value)
        .split("\n")[0]
        ?.replace(/\s+/gu, " ")
        .trim() ?? "";

    return Array.from(first).slice(0, TITLE_MAX).join("");
  };

  const walk = (node: Titlable): string => line(node.text) || (node.children ?? []).map(walk).find((title) => title !== "") || "";

  return (root?.children ?? []).map(walk).find((title) => title !== "") ?? "";
}

/// A title field as the writer of it needs it, in either shape the fork hands: the reactive block
/// text, emptied by its own `clear` and filled by its own `insert` so the write rides the fork's
/// transaction, or the plain shared type standing bare, emptied and filled at its ends.
interface WritableText {
  clear: () => void;
  insert: (text: string, at: number) => void;
}

function plainYText(holder: unknown): WritableText | null {
  const maybe = holder as { length?: unknown; delete?: unknown; insert?: unknown } | null | undefined;

  if (typeof maybe?.length !== "number" || typeof maybe.delete !== "function" || typeof maybe.insert !== "function") return null;

  const text = maybe as { length: number; delete: (at: number, len: number) => void; insert: (content: string, at: number) => void };

  return {
    clear: () => text.delete(0, text.length),
    insert: (content, at) => text.insert(content, at)
  };
}

function writableTitle(slot: unknown): WritableText | null {
  const holder = slot as { clear?: unknown; insert?: unknown; yText?: unknown } | null | undefined;

  if (typeof holder?.clear === "function" && typeof holder.insert === "function") return holder as WritableText;

  return plainYText(holder?.yText ?? holder);
}

/// Writes the note's own title: the words trimmed and capped as the service stores them, the field
/// emptied and filled whole so a deliberate rename does not inherit the marks it overwrites. The
/// document's own title field is the writable one, as the editor's title fragment reads and writes
/// it; the plain shared type of an older document answers the same call through its own ends. Where
/// the document holds no writable title field, nothing is written and the answer reads as false.
export function writeNoteTitle(root: { readonly props?: Record<string, unknown> } | null, title: string): boolean {
  const text = writableTitle(root?.props?.title ?? root?.props?.title$);

  if (text === null) return false;

  const cut = Array.from(title.trim()).slice(0, TITLE_MAX).join("");

  text.clear();
  if (cut !== "") text.insert(cut, 0);

  return true;
}
