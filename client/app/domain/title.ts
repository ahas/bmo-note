// The title a note stands under (`docs/design.md`, 「What a note is」): the title node's words, else the first
// line of words the blocks hold, cut to what the service stores — the same reading the service makes of the
// document as it saves it, so the page head, the talk and the navigator name the note as the list will.

import { rowsOfDoc, titleNode, wordsOf } from "./rows";

import type { DocNode } from "./rows";

/// The longest title the service stores (the store's title cap, mirrored).
export const TITLE_MAX = 300;

/** Words laid on one line: every run of white space one space, the ends trimmed. */
function oneLine(words: string): string {
  return words.replace(/\s+/gu, " ").trim();
}

/** The title the list shows for this document. */
export function titleOf(doc: DocNode): string {
  const own = oneLine(wordsOf(titleNode(doc)));

  if (own !== "") return Array.from(own).slice(0, TITLE_MAX).join("");

  const first = rowsOfDoc(doc).find((row) => row.text.trim() !== "");
  const line = oneLine(first?.text.split("\n").find((part) => part.trim() !== "") ?? "");

  return Array.from(line).slice(0, TITLE_MAX).join("");
}
