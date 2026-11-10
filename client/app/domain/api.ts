// The screen's calls to the note service, each at the path the service's own API writes it
// (`docs/api.md`, 「Notes」). The caller hands the call itself — through the console's relay in the
// browser, to a stand-in in a test — so this module names no address and no fetcher.

import type { Note, NoteMeta, NotesView, Page } from "../../shared/types";

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

export interface NoteApi {
  list: (view: NotesView, after?: string) => Promise<Page<NoteMeta>>;
  read: (id: string) => Promise<Note>;
  create: (write: { id: string; title: string; doc: string }) => Promise<NoteMeta>;
  save: (id: string, write: { version: number; title?: string; doc?: string; restore?: boolean }) => Promise<NoteMeta>;
  trash: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
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
        query: { deleted: view === "trash" ? "true" : undefined, after, limit: "50" }
      }),
    read: (id) => sent<Note>(`/notes/${segment(id)}`),
    create: (write) => sent<NoteMeta>("/notes", { method: "POST", body: write }),
    save: (id, write) => sent<NoteMeta>(`/notes/${segment(id)}`, { method: "PATCH", body: write }),
    trash: (id) => sent<void>(`/notes/${segment(id)}`, { method: "DELETE" }),
    purge: (id) => sent<void>(`/notes/${segment(id)}?purge=true`, { method: "DELETE" })
  };
}
