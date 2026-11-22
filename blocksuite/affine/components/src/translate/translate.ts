// The words of the editor's own chrome — the keys of its toolbars and their tooltips, the entries of its
// menus, the hint an empty line holds, the lines of its notices — are named in English inside these
// sources. Whoever mounts the editor installs the answers for them here, in the language the reader
// reads. A word nothing answers for stands exactly as it was written: the answer is asked of the mounter
// alone, so a word added to these sources is never lost and an answered word is never rewritten a second
// time. Only what a reader sees is answered; the identifiers these sources look menus up by are not.

export type WordTranslator = (said: string) => string;

let translator: WordTranslator | null = null;

/**
 * Installs the answers for the words of the editor's own chrome, or takes them away with `null`.
 * The last mounter to answer wins; the words stand for every editor drawn after it.
 */
export function setWordTranslator(next: WordTranslator | null) {
  translator = next;
}

/**
 * As `translate`, for what a renderer drew out of a template: words are answered, and anything else — a
 * further template, a number, nothing — stands as it was drawn.
 */
export function translateValue<T>(said: T): T {
  return typeof said === 'string' ? (translate(said) as T) : said;
}

/**
 * The words of the editor's own chrome, as the reader reads them.
 */
export function translate(said: string): string {
  if (translator === null || typeof said !== 'string' || said.length === 0) {
    return said;
  }

  // An answer that fails or comes back empty leaves the word as these sources wrote it: a word is never
  // a reason for a toolbar to draw nothing.
  try {
    const answered = translator(said);

    return typeof answered === 'string' && answered.length > 0
      ? answered
      : said;
  } catch {
    return said;
  }
}
