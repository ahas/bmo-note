// The navigator of the notes screen (`docs/design.md`, 「The console surface」): its sections, the order
// each stands in, the cursor that reads a section's next page, the reader's folders as a tree, and what the
// reader set for it in this browser — which sections stand folded, which folders stand unfolded, how each
// section sorts, and the notes read at full width. The splitter
// keeps the navigator's width itself; everything here is kept under the bundle's own names, read with a
// fallback wherever the browser refuses its storage.

import type { NoteFolder, NoteMeta, NotesSort } from "../../shared/types";

/** The sections of the navigator, top to bottom. */
export type SectionName = "bookmarks" | "mine" | "shared";

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
  /** The folders standing unfolded, each by its id. */
  open: string[];
}

const PREFS_KEY = "bmo-note-navigator";

/** The most notes the full-width choice is kept for, and folders kept unfolded; the oldest go first. */
const WIDE_KEPT = 200;
const OPEN_KEPT = 500;

export function defaultPrefs(): NavigatorPrefs {
  return { folded: { bookmarks: false, mine: false, shared: false }, sorts: { mine: "changed", shared: "changed" }, wide: [], open: [] };
}

function sortOf(value: unknown): NotesSort {
  return SORTS.includes(value as NotesSort) ? (value as NotesSort) : "changed";
}

/** The prefs as a kept value reads, each part that does not read standing at its default. */
export function prefsOf(kept: unknown): NavigatorPrefs {
  const prefs = defaultPrefs();
  const held = (typeof kept === "object" && kept !== null ? kept : {}) as Partial<{ folded: Record<string, unknown>; sorts: Record<string, unknown>; wide: unknown; open: unknown }>;

  for (const section of Object.keys(prefs.folded) as SectionName[]) prefs.folded[section] = held.folded?.[section] === true;
  for (const section of SORTED_SECTIONS) prefs.sorts[section] = sortOf(held.sorts?.[section]);

  prefs.wide = Array.isArray(held.wide) ? held.wide.filter((one): one is string => typeof one === "string").slice(-WIDE_KEPT) : [];
  prefs.open = Array.isArray(held.open) ? held.open.filter((one): one is string => typeof one === "string").slice(-OPEN_KEPT) : [];

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

/** A row's leading room inside its box: the row's own, and one step further in for each folder it stands in. */
export function rowInset(depth: number): string {
  return `${8 + 16 * depth}px`;
}

/** The prefs with one folder unfolded or folded. */
export function withOpen(prefs: NavigatorPrefs, folder: string, open: boolean): NavigatorPrefs {
  const rest = prefs.open.filter((one) => one !== folder);

  return { ...prefs, open: open ? [...rest, folder].slice(-OPEN_KEPT) : rest };
}

/** One folder of the tree, with the folders standing in it, by name. */
export interface FolderNode {
  folder: NoteFolder;
  /** 0 at the top. */
  depth: number;
  children: FolderNode[];
}

/** The reader's folders as a tree, each level by name as the service answers them; a folder whose parent does not
 * stand among them stands at the top. */
export function folderTree(folders: readonly NoteFolder[]): FolderNode[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const under = new Map<string | null, NoteFolder[]>();

  for (const folder of folders) {
    const parent = folder.parent !== null && ids.has(folder.parent) ? folder.parent : null;

    under.set(parent, [...(under.get(parent) ?? []), folder]);
  }

  const seen = new Set<string>();

  function grown(parent: string | null, depth: number): FolderNode[] {
    return (under.get(parent) ?? [])
      .filter((folder) => !seen.has(folder.id) && seen.add(folder.id) !== undefined)
      .map((folder) => ({ folder, depth, children: grown(folder.id, depth + 1) }));
  }

  return grown(null, 0);
}

/** The tree walked depth first: every folder with its depth, in the order the navigator draws them. */
export function folderOrder(tree: readonly FolderNode[]): FolderNode[] {
  return tree.flatMap((node) => [node, ...folderOrder(node.children)]);
}

/** The folders a folder stands in, the top one first. */
export function ancestorsOf(folders: readonly NoteFolder[], id: string): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: string[] = [];
  let at = byId.get(id)?.parent ?? null;

  while (at !== null && at !== id && byId.has(at) && !chain.includes(at)) {
    chain.unshift(at);
    at = byId.get(at)?.parent ?? null;
  }

  return chain;
}

/** Whether `held` is `folder` itself or stands anywhere inside it. */
export function holdsFolder(folders: readonly NoteFolder[], folder: string, held: string): boolean {
  return held === folder || ancestorsOf(folders, held).includes(folder);
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
