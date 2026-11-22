import koEditor from "../i18n/editor/ko.json";
import en from "../i18n/en.json";
import ko from "../i18n/ko.json";

// The bundle's words as a test reads them: a key looked up in a locale's pack and its marks filled, the
// way the console's translator fills them, and the editor's word table for each language it answers.

export const PACKS = { ko, en } as const;

/** The editor's word tables, beside the pack and outside it, by the language each answers. */
export const EDITOR_WORDS = { ko: koEditor } as const;

export function word(pack: unknown, key: string): string | undefined {
  let held: unknown = pack;

  for (const part of key.split(".")) {
    if (typeof held !== "object" || held === null) return undefined;

    held = (held as Record<string, unknown>)[part];
  }

  return typeof held === "string" ? held : undefined;
}

/** Every key a pack holds, written whole. */
export function keysOf(pack: unknown, prefix = ""): string[] {
  if (typeof pack !== "object" || pack === null) return [prefix];

  return Object.entries(pack as Record<string, unknown>).flatMap(([name, value]) => keysOf(value, prefix ? `${prefix}.${name}` : name));
}
