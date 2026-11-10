// What a note holds, for its standing line: the words of its text and the bytes the service stores
// for it (`docs/design.md`, 「The console surface」). The count walks the open document — its title,
// every text block, the table cells among them — the same document the save writes back. A database
// keeps its rows in a document of their own and stands outside the count.

import type { Store } from "@blocksuite/affine/store";

export interface Holding {
  words: number;
}

/** A node of the walked tree, read only for what the count needs. */
interface Walkable {
  title?: unknown;
  text?: unknown;
  children?: Walkable[];
}

/** The words of the open note, from its root down. */
export function countHolding(store: Store): Holding {
  let words = 0;

  const text = (value: unknown): string => {
    const held = value as { toString?: () => string } | null | undefined;

    return held?.toString?.() ?? "";
  };

  const walk = (node: Walkable): void => {
    words += countText(text(node.title)) + countText(text(node.text));

    for (const child of node.children ?? []) walk(child);
  };

  const root = store.root as unknown as Walkable | null;

  if (root !== null) walk(root);

  return { words };
}

/** Words in one run of text: runs of non-space, as a reader counts them. */
function countText(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/u).length;
}

/** The moment of a change, shown as the clock the reader's locale reads. */
export function clockOf(moment: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(moment));
}

/** The stored size, in the unit its number reads best in, as one short word. */
export function sizeOf(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);

  return `${number} ${units[unit]}`;
}
