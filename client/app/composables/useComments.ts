// The open note's comment threads (`docs/design.md`, 「Comments」): read when the note opens and again on each
// `note.commented` event of the note, started over the words chosen — the service makes the thread first, and the
// screen then lays its mark over those words — replied to, resolved and reopened, and deleted, a deleted
// thread's mark taken out of the document with it.

import { computed, ref, shallowRef } from "vue";

import type { NoteApi, NoteKey } from "../domain/api";
import type { NoteThread } from "../../shared/types";

/** What the comments ask of the open editor. */
export interface CommentEditor {
  /** Lays the thread's mark over the range that was chosen when the comment key was pressed. */
  markComment: (thread: string, range: { from: number; to: number }) => boolean;
  unmarkComment: (thread: string) => void;
  commentPlaces: () => Map<string, number>;
}

/** A new thread waiting for its first comment: the words chosen and where they stood. */
export interface Draft {
  quote: string;
  range: { from: number; to: number };
}

/** The threads in the order the panel lists them: the open ones whose words stand in the note, by where they
 * stand; the open ones whose words were deleted; and the resolved ones. */
export function orderedThreads(threads: readonly NoteThread[], places: Map<string, number>): { open: NoteThread[]; detached: NoteThread[]; resolved: NoteThread[] } {
  const open = threads.filter((thread) => thread.resolvedAt === null && places.has(thread.id));
  const detached = threads.filter((thread) => thread.resolvedAt === null && !places.has(thread.id));
  const resolved = threads.filter((thread) => thread.resolvedAt !== null);

  open.sort((left, right) => (places.get(left.id) ?? 0) - (places.get(right.id) ?? 0));

  return { open, detached, resolved };
}

/** A fresh thread id: letters and digits the comment routes take. */
export function freshThreadId(): string {
  return crypto.randomUUID().replace(/-/gu, "");
}

export function useComments(api: NoteApi, key: () => NoteKey, editor: () => CommentEditor | null) {
  const threads = ref<NoteThread[]>([]);
  const stand = ref<"loading" | "ready" | "failed">("loading");
  const draft = shallowRef<Draft | null>(null);
  const places = shallowRef<Map<string, number>>(new Map());
  let asked = 0;

  /** The threads read again; a read answered after a later one was asked is dropped. */
  async function load(): Promise<void> {
    const mine = (asked += 1);

    try {
      const read = await api.threads(key());

      if (mine !== asked) return;

      threads.value = read;
      stand.value = "ready";
      placesChanged();
    } catch {
      if (mine === asked) stand.value = "failed";
    }
  }

  /** Where the marks stand, read again as the document changes. */
  function placesChanged(): void {
    places.value = editor()?.commentPlaces() ?? new Map();
  }

  const ordered = computed(() => orderedThreads(threads.value, places.value));
  const openIds = computed(() => threads.value.filter((thread) => thread.resolvedAt === null).map((thread) => thread.id));
  const openCount = computed(() => ordered.value.open.length + ordered.value.detached.length);

  /** Starts the drafted thread with its first comment and lays its mark; answers the thread's id. */
  async function start(body: string): Promise<string | null> {
    const held = draft.value;

    if (held === null) return null;

    const id = freshThreadId();
    const thread = await api.startThread(key(), { id, quote: held.quote, body });

    editor()?.markComment(id, held.range);
    draft.value = null;
    threads.value = [...threads.value.filter((one) => one.id !== id), thread];
    placesChanged();

    return id;
  }

  async function reply(thread: string, body: string): Promise<void> {
    const comment = await api.reply(key(), thread, body);

    threads.value = threads.value.map((one) => (one.id === thread ? { ...one, comments: [...one.comments, comment] } : one));
  }

  async function resolve(thread: string, resolved: boolean): Promise<void> {
    const changed = await api.resolveThread(key(), thread, resolved);

    threads.value = threads.value.map((one) => (one.id === thread ? { ...changed, anchored: one.anchored } : one));
  }

  async function removeThread(thread: string): Promise<void> {
    await api.deleteThread(key(), thread);
    editor()?.unmarkComment(thread);
    threads.value = threads.value.filter((one) => one.id !== thread);
  }

  async function removeComment(thread: string, comment: string): Promise<void> {
    await api.deleteComment(key(), thread, comment);

    const left = threads.value.map((one) => (one.id === thread ? { ...one, comments: one.comments.filter((said) => said.id !== comment) } : one));
    const emptied = left.find((one) => one.id === thread)?.comments.length === 0;

    // A thread goes with its last comment, and its mark with it.
    if (emptied) editor()?.unmarkComment(thread);

    threads.value = left.filter((one) => one.comments.length > 0);
  }

  return { threads, stand, draft, ordered, openIds, openCount, load, placesChanged, start, reply, resolve, removeThread, removeComment };
}

export type Comments = ReturnType<typeof useComments>;
