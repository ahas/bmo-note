// The navigator's board (`docs/design.md`, 「The console surface」): the pinned notes, the reader's own and
// the ones shared with them, each section read a page at a time in the order the reader chose, and the
// trash, read when its popover opens. The service's events read every section again in place, but for a
// thread's change, which is handed to the open note's comments. The writes the screen makes from a row — a pin, a copy, the trash — are here too, each
// reading the board again once it lands.

import { computed, reactive, ref, shallowRef } from "vue";

import { keyOfNote } from "../domain/api";
import { emptyDoc } from "../domain/document";
import { cursorOf, keepPrefs, noteKeyOf, readPrefs, SECTION_PAGE } from "../domain/navigator";
import { COMMENTED_KIND, useNoteStream } from "../domain/stream";

import type { NoteApi } from "../domain/api";
import type { NavigatorPrefs, SectionName, SORTED_SECTIONS } from "../domain/navigator";
import type { NoteStreamEvent } from "../domain/stream";
import type { NoteMeta, NotesSort } from "../../shared/types";

/** Where a section's read stands: its first fetch, its rows, or a refusal. */
export type SectionStand = "loading" | "ready" | "failed";

/** One section of rows read a page at a time. */
export interface SectionRows {
  rows: NoteMeta[];
  more: boolean;
  stand: SectionStand;
  appending: boolean;
}

type Paged = (typeof SORTED_SECTIONS)[number];

function emptySection(): SectionRows {
  return { rows: [], more: false, stand: "loading", appending: false };
}

export function useNavigator(api: NoteApi, service: string) {
  const prefs = ref<NavigatorPrefs>(readPrefs());
  const sections = reactive<Record<Paged, SectionRows>>({ mine: emptySection(), shared: emptySection() });
  const pinned = ref<NoteMeta[]>([]);
  const pinnedStand = ref<SectionStand>("loading");
  const trash = reactive<SectionRows>(emptySection());
  const creating = ref(false);

  // A read answered after a later one was asked is dropped, so a sort changed twice in a row stands as the
  // second asked.
  const asked: Record<Paged | "trash", number> = { mine: 0, shared: 0, trash: 0 };

  const pinnedKeys = computed(() => new Set(pinned.value.map(noteKeyOf)));

  function viewOf(section: Paged | "trash") {
    return section === "mine" ? "live" : section;
  }

  function sortOf(section: Paged | "trash"): NotesSort {
    return section === "trash" ? "changed" : prefs.value.sorts[section];
  }

  function boardOf(section: Paged | "trash"): SectionRows {
    return section === "trash" ? trash : sections[section];
  }

  async function loadSection(section: Paged | "trash"): Promise<void> {
    const board = boardOf(section);
    const turn = (asked[section] += 1);

    // A first read reserves its rows with a skeleton; a read again keeps the rows standing.
    if (board.rows.length === 0) board.stand = "loading";

    try {
      const page = await api.list(viewOf(section), undefined, sortOf(section), Math.max(SECTION_PAGE, board.rows.length));

      if (turn !== asked[section]) return;

      board.rows = page.items;
      board.more = page.more;
      board.stand = "ready";

    } catch {
      if (turn === asked[section]) board.stand = "failed";
    }
  }

  async function loadPinned(): Promise<void> {
    try {
      pinned.value = await api.pinned();
      pinnedStand.value = "ready";
    } catch {
      pinnedStand.value = "failed";
    }
  }

  /** Reads every section the navigator shows. */
  function load(): Promise<void> {
    return Promise.all([loadPinned(), loadSection("mine"), loadSection("shared")]).then(() => undefined);
  }

  /** Reads the next page of a section, where one stands. */
  async function append(section: Paged | "trash"): Promise<void> {
    const board = boardOf(section);
    const last = board.rows.at(-1);

    if (!board.more || board.appending || last === undefined) return;

    board.appending = true;

    const turn = asked[section];

    try {
      const page = await api.list(viewOf(section), cursorOf(sortOf(section), last, section === "shared"), sortOf(section), SECTION_PAGE);

      if (turn !== asked[section]) return;

      board.rows = [...board.rows, ...page.items];
      board.more = page.more;

    } catch {
      // The rows standing stay; the next sight of the end asks again.
    } finally {
      board.appending = false;
    }
  }

  function keep(next: NavigatorPrefs): void {
    prefs.value = next;
    keepPrefs(next);
  }

  function setSort(section: Paged, sort: NotesSort): void {
    if (prefs.value.sorts[section] === sort) return;

    keep({ ...prefs.value, sorts: { ...prefs.value.sorts, [section]: sort } });
    sections[section].rows = [];
    void loadSection(section);
  }

  function setFolded(section: SectionName, folded: boolean): void {
    keep({ ...prefs.value, folded: { ...prefs.value.folded, [section]: folded } });
  }

  // The stream says a note moved; every section is read again whole. Events that come together are read
  // once, a moment after the last.
  let pending: ReturnType<typeof setTimeout> | null = null;

  function refresh(): void {
    if (pending !== null) clearTimeout(pending);

    pending = setTimeout(() => {
      pending = null;
      void load();

      if (trash.stand !== "loading" || trash.rows.length > 0) void loadSection("trash");
    }, 100);
  }

  // A thread's change is the open note's comments panel's to read; every other event reads the board again.
  const commented = shallowRef<NoteStreamEvent | null>(null);

  useNoteStream(
    service,
    (event) => {
      if (event.kind === COMMENTED_KIND) commented.value = event;
      else refresh();
    },
    refresh
  );

  /** Makes a note with an empty document and answers its metadata, for the screen to open. */
  async function create(): Promise<NoteMeta> {
    creating.value = true;

    try {
      const id = crypto.randomUUID();
      const meta = await api.create({ id, doc: emptyDoc() });

      refresh();

      return meta;
    } finally {
      creating.value = false;
    }
  }

  async function setPinned(note: NoteMeta, pin: boolean): Promise<void> {
    await (pin ? api.pin(keyOfNote(note)) : api.unpin(keyOfNote(note)));
    await loadPinned();
  }

  /** A copy of the note the reader's own, titled in their words; answers the copy. */
  async function duplicate(note: NoteMeta, title: string): Promise<NoteMeta> {
    const copy = await api.duplicate(keyOfNote(note), { id: crypto.randomUUID(), title });

    refresh();

    return copy;
  }

  async function moveToTrash(note: NoteMeta): Promise<void> {
    await api.trash(note.id);
    refresh();
  }

  async function restore(note: NoteMeta): Promise<void> {
    await api.save({ id: note.id }, { version: note.version, restore: true });
    refresh();
  }

  async function purge(note: NoteMeta): Promise<void> {
    await api.purge(note.id);
    refresh();
  }

  return {
    prefs,
    sections,
    pinned,
    pinnedStand,
    pinnedKeys,
    trash,
    creating,
    load,
    loadSection,
    append,
    setSort,
    setFolded,
    keep,
    refresh,
    create,
    setPinned,
    duplicate,
    moveToTrash,
    restore,
    purge,
    commented
  };
}

export type NavigatorBoard = ReturnType<typeof useNavigator>;
