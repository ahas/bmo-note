// The title a note stands under in the list (`docs/design.md`, 「What a note is」): the document's
// own title where it carries one, else the first line of its content, as the reader sees the note in
// the editor. It walks the same open document the count of `count.ts` walks, on types alone.

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
