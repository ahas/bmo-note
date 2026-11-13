// The screen's calls to the note service, each at the path the service's own API writes it
// (`docs/api.md`, 「Notes」). The caller hands the call itself — through the console's relay in the
// browser, to a stand-in in a test — so this module names no address and no fetcher.

import type { MemberPermission, Note, NoteLink, NoteMember, NoteMeta, NotesView, Page, SharedNote } from "../../shared/types";

export type Call = <T>(path: string, options?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; query?: Record<string, string | undefined> }) => Promise<T>;

/** A write the service answered with a refusal: its status and its code (`docs/api.md`, 「Codes」). */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The note as it stands, carried by a `version-conflict`. */
    readonly note?: NoteMeta
  ) {
    super(message);
  }
}

/** A call that never reached the service: the network, not the service, said no. */
export class Unreachable extends Error {}

// What the fetcher threw, sorted into the two kinds the screen answers differently: a refusal the
// service gave, and a call that never landed, which waits to be sent again.
function sorted(error: unknown): Error {
  const failed = error as { response?: { status?: number; _data?: unknown }; status?: number; statusCode?: number; data?: { code?: unknown; error?: unknown; note?: unknown } } | null;
  const status = failed?.response?.status ?? failed?.statusCode ?? failed?.status;

  if (typeof status === "number" && status > 0) {
    const data = (failed?.data ?? failed?.response?._data ?? {}) as { code?: unknown; error?: unknown; note?: unknown };
    const code = typeof data.code === "string" ? data.code : "failed";
    const message = typeof data.error === "string" ? data.error : String(status);
    const note = typeof data.note === "object" && data.note !== null ? (data.note as NoteMeta) : undefined;

    return new Refusal(status, code, message, note);
  }

  return new Unreachable(error instanceof Error ? error.message : String(error));
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

/** The note a call reaches: the reader's own by its id, or another account's shared with the reader,
 * named by its owner too (`docs/api.md`, 「Sharing」). */
export interface NoteKey {
  id: string;
  /** The account the note belongs to, where it is not the reader's own. */
  owner?: string;
}

export interface NoteApi {
  list: (view: NotesView, after?: string) => Promise<Page<NoteMeta>>;
  read: (key: NoteKey) => Promise<Note>;
  create: (write: { id: string; title: string; doc: string }) => Promise<NoteMeta>;
  save: (key: NoteKey, write: { version: number; title?: string; doc?: string; restore?: boolean }) => Promise<NoteMeta>;
  trash: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
  /** The note's live link, or null where none stands. */
  link: (id: string) => Promise<NoteLink | null>;
  makeLink: (id: string, expiresAt: number | null) => Promise<NoteLink>;
  endLink: (id: string) => Promise<void>;
  members: (id: string) => Promise<NoteMember[]>;
  share: (id: string, users: string[], permission: MemberPermission) => Promise<NoteMember[]>;
  changeMember: (id: string, user: string, permission: MemberPermission) => Promise<NoteMember>;
  unshare: (id: string, user: string) => Promise<void>;
  /** The note a link's token opens, read with the token alone. */
  shared: (token: string) => Promise<SharedNote>;
}

/** The query naming the note's owner, where the note is another account's. */
function ownerQuery(key: NoteKey): Record<string, string | undefined> | undefined {
  return key.owner === undefined ? undefined : { owner: key.owner };
}

export function createNoteApi(call: Call): NoteApi {
  async function sent<T>(path: string, options?: Parameters<Call>[1]): Promise<T> {
    try {
      return await call<T>(path, options);
    } catch (error) {
      throw sorted(error);
    }
  }

  return {
    list: (view, after) =>
      sent<Page<NoteMeta>>("/notes", {
        query: { deleted: view === "trash" ? "true" : undefined, shared: view === "shared" ? "true" : undefined, after, limit: "50" }
      }),
    read: (key) => sent<Note>(`/notes/${segment(key.id)}`, { query: ownerQuery(key) }),
    create: (write) => sent<NoteMeta>("/notes", { method: "POST", body: write }),
    save: (key, write) => sent<NoteMeta>(`/notes/${segment(key.id)}`, { method: "PATCH", body: write, query: ownerQuery(key) }),
    trash: (id) => sent<void>(`/notes/${segment(id)}`, { method: "DELETE" }),
    purge: (id) => sent<void>(`/notes/${segment(id)}?purge=true`, { method: "DELETE" }),
    link: async (id) => {
      try {
        return await sent<NoteLink>(`/notes/${segment(id)}/link`);
      } catch (error) {
        if (error instanceof Refusal && error.code === "not-found") return null;

        throw error;
      }
    },
    makeLink: (id, expiresAt) => sent<NoteLink>(`/notes/${segment(id)}/link`, { method: "POST", body: { expiresAt } }),
    endLink: (id) => sent<void>(`/notes/${segment(id)}/link`, { method: "DELETE" }),
    members: async (id) => (await sent<Page<NoteMember>>(`/notes/${segment(id)}/members`)).items,
    share: async (id, users, permission) => (await sent<Page<NoteMember>>(`/notes/${segment(id)}/members`, { method: "POST", body: { users, permission } })).items,
    changeMember: (id, user, permission) => sent<NoteMember>(`/notes/${segment(id)}/members/${segment(user)}`, { method: "PATCH", body: { permission } }),
    unshare: (id, user) => sent<void>(`/notes/${segment(id)}/members/${segment(user)}`, { method: "DELETE" }),
    shared: (token) => sent<SharedNote>(`/shares/${segment(token)}`)
  };
}
