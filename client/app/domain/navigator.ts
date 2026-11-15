// The navigator of the notes screen (`docs/design.md`, 「The console surface」): its sections, the order
// each stands in, the cursor that reads a section's next page, and what the reader set for it in this
// browser — which sections stand folded, how each sorts, and the notes read at full width. The splitter
// keeps the navigator's width itself; everything here is kept under the bundle's own names, read with a
// fallback wherever the browser refuses its storage.

import type { NoteMeta, NotesSort } from "../../shared/types";

/** The sections of the navigator, top to bottom. */
export type SectionName = "pinned" | "mine" | "shared";

/** The sections a reader sorts, and the orders offered, the default first. */
export const SORTED_SECTIONS = ["mine", "shared"] as const;
export const SORTS: readonly NotesSort[] = ["changed", "title", "created"];

/** How many rows a section reads at a time. */
export const SECTION_PAGE = 30;

/** The navigator's width in pixels: its bounds, and where it stands at first. */
export const NAVIGATOR_MIN_PX = 200;
export const NAVIGATOR_MAX_PX = 480;
export const NAVIGATOR_FIRST_PX = 260;

/** What a reader set for the navigator in this browser. */
export interface NavigatorPrefs {
  folded: Record<SectionName, boolean>;
  sorts: Record<(typeof SORTED_SECTIONS)[number], NotesSort>;
  /** The notes read at full width, each by its `owner/id`. */
  wide: string[];
}

const PREFS_KEY = "bmo-note-navigator";

/** The most notes the full-width choice is kept for; the oldest go first. */
const WIDE_KEPT = 200;

export function defaultPrefs(): NavigatorPrefs {
  return { folded: { pinned: false, mine: false, shared: false }, sorts: { mine: "changed", shared: "changed" }, wide: [] };
}

function sortOf(value: unknown): NotesSort {
  return SORTS.includes(value as NotesSort) ? (value as NotesSort) : "changed";
}

/** The prefs as a kept value reads, each part that does not read standing at its default. */
export function prefsOf(kept: unknown): NavigatorPrefs {
  const prefs = defaultPrefs();
  const held = (typeof kept === "object" && kept !== null ? kept : {}) as Partial<{ folded: Record<string, unknown>; sorts: Record<string, unknown>; wide: unknown }>;

  for (const section of Object.keys(prefs.folded) as SectionName[]) prefs.folded[section] = held.folded?.[section] === true;
  for (const section of SORTED_SECTIONS) prefs.sorts[section] = sortOf(held.sorts?.[section]);

  prefs.wide = Array.isArray(held.wide) ? held.wide.filter((one): one is string => typeof one === "string").slice(-WIDE_KEPT) : [];

  return prefs;
}

/** The prefs kept in this browser, the defaults where none are kept or storage is refused. */
export function readPrefs(): NavigatorPrefs {
  try {
    const kept = localStorage.getItem(PREFS_KEY);

    return prefsOf(kept === null ? null : JSON.parse(kept));
  } catch {
    return defaultPrefs();
  }
}

/** The prefs kept for the next visit; a browser that refuses keeps them for this page alone. */
export function keepPrefs(prefs: NavigatorPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage refused: the choice holds while the page stands.
  }
}

/** The prefs with one note's full width turned on or off. */
export function withWide(prefs: NavigatorPrefs, key: string, wide: boolean): NavigatorPrefs {
  const rest = prefs.wide.filter((one) => one !== key);

  return { ...prefs, wide: wide ? [...rest, key].slice(-WIDE_KEPT) : rest };
}

/** A note's key among the reader's: its owner and its id. */
export function noteKeyOf(note: Pick<NoteMeta, "owner" | "id">): string {
  return `${note.owner}/${note.id}`;
}

/** A string's UTF-8 as unpadded base64url, the way a title cursor carries it. */
export function base64url(text: string): string {
  let binary = "";

  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The cursor that reads the page after `last` in `sort` (`docs/api.md`, 「Notes」). */
export function cursorOf(sort: NotesSort, last: NoteMeta, shared: boolean): string {
  const key = sort === "title" ? base64url(last.title) : String(sort === "created" ? last.createdAt : last.changedAt);
  const cursor = `${key}:${last.id}`;

  return shared ? `${cursor}:${last.owner}` : cursor;
}

/** The address a note opens at on the screen: its id, its owner where it is another's, and the trash mark. */
export function notePath(note: Pick<NoteMeta, "id" | "owner" | "access" | "deletedAt">): string {
  const path = `/note/${encodeURIComponent(note.id)}`;

  if (note.deletedAt !== null) return `${path}?trash=1`;

  return note.access === "owner" ? path : `${path}?owner=${encodeURIComponent(note.owner)}`;
}

/** Whether a press asks for a new tab: Ctrl, or ⌘ on a Mac, held. */
export function asksNewTab(event: MouseEvent | KeyboardEvent | null | undefined): boolean {
  return event !== null && event !== undefined && (event.ctrlKey || event.metaKey);
}
