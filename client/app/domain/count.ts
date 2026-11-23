// What a note holds, for its standing line: the words of its title and blocks and the bytes the service
// stores, and the moments and sizes the bar writes.

import { wordsOf } from "./rows";

import type { DocNode } from "./rows";

export interface Holding {
  words: number;
}

/** The words of a document, its title and every block counted as a reader counts them, block by block. */
export function countWords(doc: DocNode): number {
  let words = 0;
  const read = (node: DocNode): void => {
    const holdsWords = node.type === "title" || node.type === "codeBlock" || (node.content ?? []).some((child) => INLINE.has(child.type));

    if (holdsWords) {
      words += countText(wordsOf(node));

      return;
    }

    for (const child of node.content ?? []) read(child);
  };

  read(doc);

  return words;
}

const INLINE = new Set(["text", "mention", "hardBreak"]);

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
