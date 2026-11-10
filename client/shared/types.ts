// The note unit's wire types, as its API writes them (docs/api.md, 「Notes」).

/** A note without its document, as the list and the writes answer it. */
export interface NoteMeta {
  id: string;
  /** May be empty; the screen names an empty one by its untitled word. */
  title: string;
  version: number;
  createdAt: number;
  changedAt: number;
  size: number;
  deletedAt: number | null;
}

/** A note with its document, base64 of the whole Yjs state. */
export interface Note extends NoteMeta {
  doc: string;
}

/** A page of rows, newest changed first. */
export interface Page<T> {
  items: T[];
  more: boolean;
}

export type NotesView = "live" | "trash";
