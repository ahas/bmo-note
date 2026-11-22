// The words of the editor's own chrome — the keys of its toolbars and their tooltips, the entries of its
// menus, the lines a hover room holds, the hint an empty line holds, the lines of its notices — are named
// in English inside these sources. Whoever mounts the editor installs the answers for them here, in the
// language the reader reads. A word nothing answers for stands exactly as it was written: the answer is
// asked of the mounter alone, so a word added to these sources is never lost and an answered word is never
// rewritten a second time. Only what a reader sees is answered; the identifiers these sources look menus up
// by are not.

export type WordTranslator = (said: string) => string;

// What a drawing holds that is no line of words: its own markup, or a reader's field.
const NOT_WORDS = new Set(['STYLE', 'SCRIPT', 'TITLE', 'TEXTAREA', 'NOSCRIPT']);

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
 * Asks the words of what a renderer has drawn, where they stand. A room drawn out of a template holds its
 * markup and its words together, so no word of one can be asked before it is drawn: each line of words the
 * drawing holds is asked as one line with its outer spacing cut away, and what it answers for is put back
 * where the line stood. A drawing that holds no line of words — a number, a formula, a piece of code — and
 * a line nothing answers for stand exactly as they were drawn.
 */
export function translateDrawn(drawing: Node) {
  if (translator === null) {
    return;
  }

  for (const line of linesOfWords(drawing)) {
    const said = line.data.trim().replace(/\s+/g, ' ');
    const answered = translate(said);

    if (answered === said) {
      continue;
    }

    const before = line.data.slice(0, line.data.length - line.data.trimStart().length);
    const after = line.data.slice(line.data.trimEnd().length);

    line.data = before + answered + after;
  }
}

/** Every line of words a drawing holds, in the order it holds them. */
function linesOfWords(drawing: Node): Text[] {
  const owner = drawing.ownerDocument;
  const lines: Text[] = [];

  if (owner === null) {
    return lines;
  }

  if (drawing.nodeType === Node.TEXT_NODE) {
    lines.push(drawing as Text);
  }

  const walker = owner.createTreeWalker(drawing, NodeFilter.SHOW_TEXT, {
    acceptNode: (node: Node) =>
      asksAsWords(node as Text)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    lines.push(node as Text);
  }

  return lines;
}

/** Whether a piece of a drawing is a line of words a reader reads. */
function asksAsWords(line: Text): boolean {
  if (line.data.trim().length === 0) {
    return false;
  }

  const holder = line.parentElement ?? line.parentNode;

  if (holder === null || NOT_WORDS.has(holder.nodeName.toUpperCase())) {
    return false;
  }

  // What the drawing lays in the editor's code face is code, and code is never a word to answer.
  return !drawnInCodeFace(line);
}

function drawnInCodeFace(line: Text): boolean {
  let holder: Element | null = line.parentElement;

  while (holder !== null) {
    const family = holder.getAttribute('font-family');

    if (family !== null && family.toLowerCase().includes('code')) {
      return true;
    }

    holder = holder.parentElement;
  }

  return false;
}

/**
 * A line of the editor's own chrome that carries a value — a count, a name — asked as one line with each
 * value standing as `{name}` where it falls, so the answer may place the value where its language puts it.
 * The answer, or the line as these sources wrote it, is then filled with the values; a `{name}` nothing
 * fills stands as written.
 */
export function translateFilled(
  said: string,
  fills: Record<string, string | number>
): string {
  return translate(said).replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(fills, name) ? String(fills[name]) : whole
  );
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
