// The note unit's wire types, as its API writes them (docs/api.md, 「Notes」, 「Sharing」).

/** What a caller holds of a note: its own account's, or a member's share. */
export type NoteAccess = "owner" | "edit" | "read";

/** A note without its document, as the list and the writes answer it. */
export interface NoteMeta {
  id: string;
  /** The account key the note belongs to. */
  owner: string;
  /** May be empty; the screen names an empty one by its untitled word. */
  title: string;
  version: number;
  createdAt: number;
  changedAt: number;
  size: number;
  deletedAt: number | null;
  access: NoteAccess;
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

/** The reader's own live notes, the notes other accounts share with the reader, and the reader's trash. */
export type NotesView = "live" | "shared" | "trash";

/** A note's share link; its moments in epoch ms, its end null where it never ends. */
export interface NoteLink {
  token: string;
  noteId: string;
  createdAt: number;
  expiresAt: number | null;
}

/** A member's permission. */
export type MemberPermission = "read" | "edit";

/** One account a note is shared with. */
export interface NoteMember {
  user: string;
  permission: MemberPermission;
  sharedAt: number;
}

/** The note a link opens, as its share page reads it. */
export interface SharedNote {
  id: string;
  title: string;
  changedAt: number;
  size: number;
  expiresAt: number | null;
  doc: string;
}
