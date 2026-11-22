// The editor's own words, answered in the console's language (`docs/design.md`, 「The editor's own words
// follow the console's language」). The fork names the words of its own chrome in English inside its own
// sources and ships no translation, so it carries one seam: a translator asked whenever a word of that
// chrome is drawn. This module installs the answers, which the screen hands over from its pack keyed by
// the words the fork says. A word the pack does not hold stands as the fork wrote it, so a key the fork
// adds later is never shown as nothing, and an answered word is never answered a second time.

import { setWordTranslator } from "@blocksuite/affine/components/translate";

/** The pack the last mounted editor answered from, kept so the screen's own dialogs read the same words. */
let held: Record<string, string> = {};

/**
 * Answers the editor's own words from `table`, which stands the console's word for each word the fork
 * says. Called as an editor is mounted, and the last mount answers the editor drawn after it.
 */
export function answerEditorWords(table: Record<string, string>): void {
  held = table;

  setWordTranslator(answered);
}

/**
 * What the editor says in its own words, as the reader reads them: the pack's word for a word the fork
 * says, and the word itself where the pack holds none. The editor's chrome is answered by the fork's own
 * seam; this answers the words that reach a dialog or a notice the screen draws instead.
 */
export function answered(said: string): string {
  return Object.hasOwn(held, said) ? held[said]! : said;
}
