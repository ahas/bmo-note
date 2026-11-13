// The notes the list screen draws, read and moved through the console's relay to the note service
// (`docs/api.md`, 「Notes」), refreshed on the service's own events.

import { ref } from "vue";
import { relayCall } from "bmo-ui/app/domain/relay";

import { emptyNoteDoc, toBase64 } from "../domain/doc";
import { createNoteApi } from "../domain/api";
import { useNoteStream } from "../domain/stream";

import type { RelayOptions } from "bmo-ui/app/domain/relay";
import type { Call } from "../domain/api";
import type { NoteMeta, NotesView } from "../../shared/types";

const SERVICE = "note";

const call: Call = <T>(path: string, options?: Parameters<Call>[1]) => relayCall<T>(SERVICE, path, options as RelayOptions);

const api = createNoteApi(call);

// The way back to a note the reader was just reading: the row that was opened and the scroll the list
// stood at when it was. The list screen is torn down on the way into a note and built again on the way
// back, so the visit stands at module level rather than in the screen.
let visit: { id: string; top: number } | null = null;

/** The list notes that `id` is being opened at scroll `top`, for the way back to find its place. */
export function rememberVisit(id: string, top: number): void {
  visit = { id, top };
}

/** The visit to return from, once: reading it takes it, so only the first return after a note was
 * opened puts the place back, and a list kept open across no visit at all stands where it is. */
export function takeVisit(): { id: string; top: number } | null {
  const left = visit;

  visit = null;

  return left;
}

/** The list board: the rows it holds, where it stands, and the writes the screen makes on it. */
export function useNotes() {
  const view = ref<NotesView>("live");
  const rows = ref<NoteMeta[]>([]);
  const more = ref(false);
  const cursor = ref<string | null>(null);
  const stand = ref<"loading" | "ready" | "failed">("loading");
  const appending = ref(false);
  const creating = ref(false);

  let refreshed: Promise<void> | null = null;

  function pageCursor(page: { items: NoteMeta[]; more: boolean }): string | null {
    const last = page.items[page.items.length - 1];

    if (last === undefined) return null;

    // Two accounts may each hold a note at one id, so the shared view's rows are told apart by owner too.
    return view.value === "shared" ? `${last.changedAt}:${last.id}:${last.owner}` : `${last.changedAt}:${last.id}`;
  }

  async function load(): Promise<void> {
    if (rows.value.length === 0) stand.value = "loading";

    try {
      const page = await api.list(view.value);

      rows.value = page.items;
      more.value = page.more;
      cursor.value = pageCursor(page);
      stand.value = "ready";
    } catch {
      stand.value = "failed";
    }
  }

  async function append(): Promise<void> {
    if (cursor.value === null || appending.value) return;

    appending.value = true;

    try {
      const page = await api.list(view.value, cursor.value ?? undefined);

      rows.value = [...rows.value, ...page.items];
      more.value = page.more;
      cursor.value = pageCursor(page);
    } finally {
      appending.value = false;
    }
  }

  function switchView(next: NotesView): void {
    if (view.value === next) return;

    view.value = next;
    rows.value = [];
    void load();
  }

  // The stream says a note moved; the list is read again whole. One read covers events that came
  // together, and a read standing while an event came is asked again when it ends.
  function refresh(): void {
    if (refreshed !== null) {
      refreshed = refreshed.then(() => {
        refreshed = null;

        return load();
      });

      return;
    }

    refreshed = load().finally(() => {
      refreshed = null;
    });
  }

  let pending: ReturnType<typeof setTimeout> | null = null;

  useNoteStream(
    SERVICE,
    () => {
      if (pending !== null) clearTimeout(pending);

      pending = setTimeout(() => {
        pending = null;
        refresh();
      }, 100);
    },
    refresh
  );

  /** Makes a note with an empty document and answers its id, for the screen to open. */
  async function create(): Promise<string> {
    creating.value = true;

    try {
      const id = crypto.randomUUID();
      const doc = emptyNoteDoc(id);
      const meta = await api.create({ id, title: "", doc: toBase64(doc.serialize()) });

      doc.dispose();

      return meta.id;
    } finally {
      creating.value = false;
    }
  }

  async function trash(id: string): Promise<void> {
    await api.trash(id);
    await load();
  }

  async function restore(id: string, version: number): Promise<void> {
    await api.save({ id }, { version, restore: true });
    await load();
  }

  async function purge(id: string): Promise<void> {
    await api.purge(id);
    await load();
  }

  return { view, rows, more, stand, appending, creating, load, append, switchView, refresh, create, trash, restore, purge };
}
