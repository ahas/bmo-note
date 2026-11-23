// The editor's own words, answered in the console's language (`docs/design.md`, 「The editor's own words
// follow the console's language」). The fork names the words of its own chrome in English inside its own
// sources and ships no translation, so it carries one seam: a translator asked whenever a word of that
// chrome is drawn. This module installs the answers from the editor's word table for the console's
// language, keyed by the words the fork says. A word the table does not hold stands as the fork wrote it,
// so a key the fork adds later is never shown as nothing, and an answered word is never answered a second
// time.
//
// The tables are the editor's own locale and stand outside the pack: the pack holds only keys a screen
// asks for written whole, each answered by one word, and the bundle build refuses a screen that asks it for
// a tree.

import { setWordTranslator } from "@blocksuite/affine/components/translate";

import { TABLES } from "./word-tables";

import type { WordTable } from "./word-tables";

/** The table the last mounted editor answered from, kept so the screen's own dialogs read the same words. */
let held: WordTable = {};

/**
 * Answers the editor's own words in `language`, the console's language as a locale code: from its table,
 * and with nothing where the bundle carries no table for it, so the fork's English stands. Called as an
 * editor is mounted, and the last mount answers the editor drawn after it.
 */
export function answerEditorWords(language: string): void {
  held = TABLES[language] ?? {};

  setWordTranslator(answered);
}

/**
 * What the editor says in its own words, as the reader reads them: the table's word for a word the fork
 * says, and the word itself where the table holds none. The editor's chrome is answered by the fork's own
 * seam; this answers the words that reach a dialog or a notice the screen draws instead.
 */
export function answered(said: string): string {
  return Object.hasOwn(held, said) ? held[said]! : said;
}
