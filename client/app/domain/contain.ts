// The vendored editor's stylesheets held to the editor (`docs/design.md`, 「The console surface」). The editor lays
// them on the page as plain style elements, unlayered, so each beats every layered rule of the console; a rule whose
// selector names nothing of the editor's own would reach every screen of the console for the life of the tab. Each
// such rule is held to the editor's host; the rest stand as laid.

/** The attribute the editor's host carries, which the held rules are bound under. */
export const EDITOR_HOST = "data-note-editor";

const HELD = `:where([${EDITOR_HOST}])`;

// A custom element's name (`affine-…`, `editor-host`), or a class, id or attribute of the editor's own.
const CUSTOM_ELEMENT = /(?:^|[\s>+~(,])[a-z][a-z0-9]*-[a-z0-9-]*/;
const OWN_NAME = /[.#[]\s*(?:data-)?(?:affine|blocksuite|edgeless|block-id)/i;
// The page-wide rules, which carry the editor's variables for its portals too, and the shadow roots' own.
const PAGE_WIDE = /^\s*(?::root|html|body|:host)\b/;

/** One selector of a list as it stands once held: unchanged where it names the editor's own or the page, else
 *  bound under the editor's host. */
export function heldSelector(selector: string): string {
  const part = selector.trim();

  if (part === "" || part.startsWith(HELD) || PAGE_WIDE.test(part) || CUSTOM_ELEMENT.test(part) || OWN_NAME.test(part)) return part;

  return `${HELD} ${part}`;
}

/** A selector list as it stands once held, split on its top-level commas. */
export function heldSelectorList(list: string): string {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let at = 0; at < list.length; at += 1) {
    const char = list[at];

    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, at));
      start = at + 1;
    }
  }

  parts.push(list.slice(start));

  return parts.map(heldSelector).join(", ");
}

/** Whether a style element is one the editor laid: a plain one of the page's head, naming the editor. */
function editors(node: Node): node is HTMLStyleElement {
  return node instanceof HTMLStyleElement && node.attributes.length === 0 && /affine|blocksuite/.test(node.textContent ?? "");
}

function holdRules(rules: CSSRuleList): void {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const held = heldSelectorList(rule.selectorText);

      if (held !== rule.selectorText) rule.selectorText = held;
    } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      holdRules(rule.cssRules);
    }
  }
}

function hold(node: Node): void {
  if (!editors(node) || node.sheet === null) return;

  try {
    holdRules(node.sheet.cssRules);
  } catch {
    // A sheet the page may not read stands as laid.
  }
}

let watching = false;

/** From now on, every stylesheet the editor lays on the page is held to the editor's host, and every one it has
 *  laid already. Done once for the tab. */
export function containEditorStyles(): void {
  if (watching || typeof document === "undefined") return;

  watching = true;

  for (const node of document.head.querySelectorAll("style")) hold(node);

  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.target instanceof HTMLStyleElement) hold(change.target);

      for (const node of change.addedNodes) hold(node);
    }
  }).observe(document.head, { childList: true, subtree: true, characterData: true });
}
