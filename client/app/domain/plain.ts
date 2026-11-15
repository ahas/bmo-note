// A note's plain text, which the service keeps for search alone (`docs/design.md`, 「What a note is」): the
// editor's own reading of the document — one line a block, in the talk's line grammar (`domain/text`) —
// with each line's mark taken off, the blocks that carry no words dropped.

import { rowsOf } from "./text";

/** The plain text of a note's lines, one block a line. */
export function plainText(lines: readonly string[]): string {
  return rowsOf([...lines])
    .map((row) => row.text)
    .filter((text) => text.trim() !== "")
    .join("\n");
}
