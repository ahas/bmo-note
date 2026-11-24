// The screen's calls to the note service, each at the path the service's own API writes it
// (`docs/api.md`, 「Notes」). The caller hands the call itself — through the console's relay in the
// browser, to a stand-in in a test — so this module names no address and no fetcher.

import type { BookmarkAsk, DocNode, FoundNote, MemberPermission, Note, NoteBookmark, NoteComment, NoteFolder, NoteLink, NoteMember, NoteMeta, NoteThread, NotesSort, NotesView, OpenedNote, Page, SearchAsk, SharedNote } from "../../shared/types";

export type Call = <T>(path: string, options?: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; query?: Record<string, string | undefined> }) => Promise<T>;

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

/** The key a write reaches a listed note by: its id, and its owner where it is another account's. */
export function keyOfNote(note: Pick<NoteMeta, "id" | "owner" | "access">): NoteKey {
  return note.access === "owner" ? { id: note.id } : { id: note.id, owner: note.owner };
}

export interface NoteApi {
  /** A page of a view; `folder` keeps the reader's live notes in the folder it names, or, empty, in none. */
  list: (view: NotesView, after?: string, sort?: NotesSort, limit?: number, folder?: string) => Promise<Page<NoteMeta>>;
  /** One note; `opened` records that the reader opened it, `trashed` reads the reader's own from the trash. */
  read: (key: NoteKey, how?: { opened?: boolean; trashed?: boolean }) => Promise<Note>;
  create: (write: { id: string; doc: DocNode; folder?: string }) => Promise<NoteMeta>;
  save: (key: NoteKey, write: { version: number; doc?: DocNode; restore?: boolean }) => Promise<NoteMeta>;
  icon: (key: NoteKey, icon: string) => Promise<NoteMeta>;
  duplicate: (key: NoteKey, write: { id: string; title: string }) => Promise<NoteMeta>;
  trash: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
  /** The reader's folders, and the writes on them (`docs/api.md`, 「Folders」). */
  folders: () => Promise<NoteFolder[]>;
  makeFolder: (write: { id: string; name: string; parent: string | null }) => Promise<NoteFolder>;
  changeFolder: (id: string, write: { name?: string; parent?: string | null }) => Promise<NoteFolder>;
  deleteFolder: (id: string) => Promise<void>;
  /** Moves the reader's own note into a folder, or into none. */
  fileNote: (id: string, folder: string | null) => Promise<NoteMeta>;
  /** The reader's bookmarks, and the writes on them (`docs/api.md`, 「Bookmarks」). */
  bookmarks: () => Promise<NoteBookmark[]>;
  addBookmark: (ask: BookmarkAsk) => Promise<NoteBookmark>;
  removeBookmark: (id: string) => Promise<void>;
  recent: (limit: number) => Promise<OpenedNote[]>;
  search: (ask: SearchAsk) => Promise<Page<FoundNote>>;
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
  /** The live notes the reader reads that link to the note (`docs/api.md`, 「Notes」). */
  backlinks: (key: NoteKey) => Promise<NoteMeta[]>;
  /** The note's comment threads (`docs/api.md`, 「Comments」). */
  threads: (key: NoteKey) => Promise<NoteThread[]>;
  startThread: (key: NoteKey, write: { id: string; quote: string; body: string }) => Promise<NoteThread>;
  reply: (key: NoteKey, thread: string, body: string) => Promise<NoteComment>;
  resolveThread: (key: NoteKey, thread: string, resolved: boolean) => Promise<NoteThread>;
  deleteThread: (key: NoteKey, thread: string) => Promise<void>;
  deleteComment: (key: NoteKey, thread: string, comment: string) => Promise<void>;
  /** One ask of the Agent over a passage or the whole note, answered by the note assistant under the reader's own
   * account (`docs/api.md`, 「Agent」): its words, or null where it said nothing. */
  agent: (key: NoteKey, ask: AgentAsk) => Promise<string | null>;
}

/** One ask of the Agent: what it works over, in the note's line grammar, the reader's instruction, the rounds
 * said before it over the same text, and over the whole note the talk it is a round of. */
export interface AgentAsk {
  mode: "passage" | "note";
  lines: string[];
  instruction: string;
  turns: { owner: boolean; text: string }[];
  talk?: string;
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
    list: (view, after, sort, limit = 50, folder) =>
      sent<Page<NoteMeta>>("/notes", {
        query: {
          deleted: view === "trash" ? "true" : undefined,
          shared: view === "shared" ? "true" : undefined,
          folder,
          sort: sort === undefined || sort === "changed" ? undefined : sort,
          after,
          limit: String(limit)
        }
      }),
    read: (key, how = {}) =>
      sent<Note>(`/notes/${segment(key.id)}`, {
        query: { ...ownerQuery(key), opened: how.opened === true ? "true" : undefined, deleted: how.trashed === true ? "true" : undefined }
      }),
    create: (write) => sent<NoteMeta>("/notes", { method: "POST", body: write }),
    save: (key, write) => sent<NoteMeta>(`/notes/${segment(key.id)}`, { method: "PATCH", body: write, query: ownerQuery(key) }),
    icon: (key, icon) => sent<NoteMeta>(`/notes/${segment(key.id)}/icon`, { method: "PUT", body: { icon }, query: ownerQuery(key) }),
    duplicate: (key, write) => sent<NoteMeta>(`/notes/${segment(key.id)}/duplicate`, { method: "POST", body: write, query: ownerQuery(key) }),
    trash: (id) => sent<void>(`/notes/${segment(id)}`, { method: "DELETE" }),
    purge: (id) => sent<void>(`/notes/${segment(id)}?purge=true`, { method: "DELETE" }),
    folders: async () => (await sent<Page<NoteFolder>>("/folders")).items,
    makeFolder: (write) => sent<NoteFolder>("/folders", { method: "POST", body: write }),
    changeFolder: (id, write) => sent<NoteFolder>(`/folders/${segment(id)}`, { method: "PATCH", body: write }),
    deleteFolder: (id) => sent<void>(`/folders/${segment(id)}`, { method: "DELETE" }),
    fileNote: (id, folder) => sent<NoteMeta>(`/notes/${segment(id)}/folder`, { method: "PUT", body: { folder } }),
    bookmarks: async () => (await sent<Page<NoteBookmark>>("/bookmarks")).items,
    addBookmark: (ask) => sent<NoteBookmark>("/bookmarks", { method: "POST", body: ask }),
    removeBookmark: (id) => sent<void>(`/bookmarks/${segment(id)}`, { method: "DELETE" }),
    recent: async (limit) => (await sent<Page<OpenedNote>>("/notes/recent", { query: { limit: String(limit) } })).items,
    search: (ask) =>
      sent<Page<FoundNote>>("/notes/search", {
        query: {
          q: ask.q,
          in: ask.views.join(","),
          titleOnly: ask.titleOnly ? "true" : undefined,
          since: ask.since === null ? undefined : String(ask.since),
          sort: ask.sort,
          after: String(ask.after),
          limit: String(ask.limit)
        }
      }),
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
    shared: (token) => sent<SharedNote>(`/shares/${segment(token)}`),
    backlinks: async (key) => (await sent<Page<NoteMeta>>(`/notes/${segment(key.id)}/backlinks`, { query: ownerQuery(key) })).items,
    threads: async (key) => (await sent<Page<NoteThread>>(`/notes/${segment(key.id)}/threads`, { query: ownerQuery(key) })).items,
    startThread: (key, write) => sent<NoteThread>(`/notes/${segment(key.id)}/threads`, { method: "POST", body: write, query: ownerQuery(key) }),
    reply: (key, thread, body) =>
      sent<NoteComment>(`/notes/${segment(key.id)}/threads/${segment(thread)}/comments`, { method: "POST", body: { body }, query: ownerQuery(key) }),
    resolveThread: (key, thread, resolved) =>
      sent<NoteThread>(`/notes/${segment(key.id)}/threads/${segment(thread)}`, { method: "PATCH", body: { resolved }, query: ownerQuery(key) }),
    deleteThread: (key, thread) => sent<void>(`/notes/${segment(key.id)}/threads/${segment(thread)}`, { method: "DELETE", query: ownerQuery(key) }),
    deleteComment: (key, thread, comment) =>
      sent<void>(`/notes/${segment(key.id)}/threads/${segment(thread)}/comments/${segment(comment)}`, { method: "DELETE", query: ownerQuery(key) }),
    agent: async (key, ask) => {
      const answered = await sent<{ answer?: string | null }>(`/notes/${segment(key.id)}/agent`, { method: "POST", body: ask, query: ownerQuery(key) });
      const words = answered.answer?.trim() ?? "";

      return words === "" ? null : words;
    }
  };
}
