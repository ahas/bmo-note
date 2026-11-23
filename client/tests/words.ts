import en from "../i18n/en.json";
import ja from "../i18n/ja.json";
import ko from "../i18n/ko.json";
import zhCN from "../i18n/zh-CN.json";

// The bundle's words as a test reads them: a key looked up in a locale's pack, the way the console's
// translator reads it.

export const PACKS = { ko, en, ja, "zh-CN": zhCN } as const;

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
