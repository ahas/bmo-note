// The navigator's board (`docs/design.md`, 「The console surface」): the reader's bookmarks, their own notes
// as their folder tree, and the ones shared with them, each section and each unfolded folder read a page at a
// time in the order the reader chose, and the trash, read when its popover opens. The service's events read
// every section again in place, but for a thread's change, which is handed to the open note's comments. The
// writes the screen makes from a row — a bookmark, a folder, a move, a copy, the trash — are here too, each
// reading the board again once it lands.

import { computed, reactive, ref, shallowRef } from "vue";

import { keyOfNote } from "../domain/api";
import { emptyDoc } from "../domain/document";
import { ancestorsOf, cursorOf, folderTree, keepPrefs, noteKeyOf, readPrefs, SECTION_PAGE, withOpen } from "../domain/navigator";
import { COMMENTED_KIND, useNoteStream } from "../domain/stream";

import type { NoteApi } from "../domain/api";
import type { NavigatorPrefs, SectionName, SORTED_SECTIONS } from "../domain/navigator";
import type { NoteStreamEvent } from "../domain/stream";
import type { BookmarkAsk, NoteBookmark, NoteFolder, NoteMeta, NotesSort } from "../../shared/types";

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
  const bookmarks = ref<NoteBookmark[]>([]);
  const bookmarksStand = ref<SectionStand>("loading");
  const folders = ref<NoteFolder[]>([]);
  const foldersStand = ref<SectionStand>("loading");
  // The notes of each unfolded folder, read as a section's are.
  const folderRows = reactive<Record<string, SectionRows>>({});
  const trash = reactive<SectionRows>(emptySection());
  const creating = ref(false);
  // The folder whose name stands open in its row, and the folder a bookmark just brought into sight.
  const naming = ref<string | null>(null);
  const shown = ref<string | null>(null);

  // A read answered after a later one was asked is dropped, so a sort changed twice in a row stands as the
  // second asked. A folder's turn is kept under its id.
  const asked: Record<string, number> = { mine: 0, shared: 0, trash: 0 };

  const tree = computed(() => folderTree(folders.value));
  const noteMarks = computed(() => new Map(bookmarks.value.filter((one) => one.kind === "note" && one.note !== null).map((one) => [noteKeyOf(one.note!), one.id])));
  const folderMarks = computed(() => new Map(bookmarks.value.filter((one) => one.kind === "folder" && one.folder !== null).map((one) => [one.folder!.id, one.id])));
  /** The open note's line bookmarks, by `owner/id`, each block id with its bookmark's id. */
  const lineMarks = computed(() => {
    const marks = new Map<string, Map<string, string>>();

    for (const one of bookmarks.value) {
      if (one.kind !== "line" || one.note === null || one.block === null) continue;

      const key = noteKeyOf(one.note);

      marks.set(key, new Map([...(marks.get(key) ?? []), [one.block, one.id]]));
    }

    return marks;
  });

  /** A section's name, or a folder's id prefixed, as the reads are kept by. */
  type Place = Paged | "trash" | `folder:${string}`;

  function folderOf(place: Place): string | undefined {
    return place.startsWith("folder:") ? place.slice("folder:".length) : undefined;
  }

  function viewOf(place: Place) {
    return place === "shared" || place === "trash" ? place : "live";
  }

  function sortOf(place: Place): NotesSort {
    return place === "trash" ? "changed" : place === "shared" ? prefs.value.sorts.shared : prefs.value.sorts.mine;
  }

  function boardOf(place: Place): SectionRows {
    const folder = folderOf(place);

    if (folder !== undefined) {
      // Read back through the reactive record, so what a read writes into the rows is drawn.
      if (!(folder in folderRows)) folderRows[folder] = emptySection();

      return folderRows[folder]!;
    }

    return place === "trash" ? trash : sections[place as Paged];
  }

  // The own section's notes are the ones standing in no folder; an unfolded folder's, the ones standing in it.
  function folderQuery(place: Place): string | undefined {
    return place === "mine" ? "" : folderOf(place);
  }

  async function loadSection(place: Place): Promise<void> {
    const board = boardOf(place);
    const turn = (asked[place] = (asked[place] ?? 0) + 1);

    // A first read reserves its rows with a skeleton; a read again keeps the rows standing.
    if (board.rows.length === 0) board.stand = "loading";

    try {
      const page = await api.list(viewOf(place), undefined, sortOf(place), Math.max(SECTION_PAGE, board.rows.length), folderQuery(place));

      if (turn !== asked[place]) return;

      board.rows = page.items;
      board.more = page.more;
      board.stand = "ready";

    } catch {
      if (turn === asked[place]) board.stand = "failed";
    }
  }

  async function loadBookmarks(): Promise<void> {
    try {
      bookmarks.value = await api.bookmarks();
      bookmarksStand.value = "ready";
    } catch {
      bookmarksStand.value = "failed";
    }
  }

  async function loadFolders(): Promise<void> {
    try {
      folders.value = await api.folders();
      foldersStand.value = "ready";

      // A folder that no longer stands is no longer kept unfolded.
      const standing = new Set(folders.value.map((folder) => folder.id));
      const kept = prefs.value.open.filter((id) => standing.has(id));

      if (kept.length !== prefs.value.open.length) keep({ ...prefs.value, open: kept });
    } catch {
      foldersStand.value = "failed";
    }
  }

  /** The folders standing unfolded. */
  function openFolders(): string[] {
    const standing = new Set(folders.value.map((folder) => folder.id));

    return prefs.value.open.filter((id) => standing.has(id));
  }

  /** Reads every section the navigator shows, and the notes of every unfolded folder. */
  async function load(): Promise<void> {
    await Promise.all([loadBookmarks(), loadFolders(), loadSection("mine"), loadSection("shared")]);
    await Promise.all(openFolders().map((id) => loadSection(`folder:${id}`)));
  }

  /** Reads the next page of a section or a folder, where one stands. */
  async function append(place: Place): Promise<void> {
    const board = boardOf(place);
    const last = board.rows.at(-1);

    if (!board.more || board.appending || last === undefined) return;

    board.appending = true;

    const turn = asked[place];

    try {
      const page = await api.list(viewOf(place), cursorOf(sortOf(place), last, place === "shared"), sortOf(place), SECTION_PAGE, folderQuery(place));

      if (turn !== asked[place]) return;

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

    // The folders' notes stand in the own section's order.
    if (section === "mine") {
      for (const id of openFolders()) {
        boardOf(`folder:${id}`).rows = [];
        void loadSection(`folder:${id}`);
      }
    }
  }

  /** Unfolds or folds a folder; an unfolded folder reads its notes. */
  function setOpen(folder: string, open: boolean): void {
    keep(withOpen(prefs.value, folder, open));

    if (open) void loadSection(`folder:${folder}`);
  }

  /** Unfolds a folder and every folder it stands in, and marks it a moment for the screen to bring into sight. */
  function reveal(folder: string): void {
    for (const id of [...ancestorsOf(folders.value, folder), folder]) if (!prefs.value.open.includes(id)) setOpen(id, true);

    shown.value = folder;
    setTimeout(() => {
      if (shown.value === folder) shown.value = null;
    }, 1600);
  }

  function setFolded(section: SectionName, folded: boolean): void {
    keep({ ...prefs.value, folded: { ...prefs.value.folded, [section]: folded } });
  }

  // The stream says a note, a folder or a bookmark moved; every section and every unfolded folder is read
  // again whole. Events that come together are read once, a moment after the last.
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

  /** Makes a note with an empty document, in a folder or at the top, and answers its metadata, for the screen to
   * open. */
  async function create(folder?: string): Promise<NoteMeta> {
    creating.value = true;

    try {
      const id = crypto.randomUUID();
      const meta = await api.create({ id, doc: emptyDoc(), ...(folder === undefined ? {} : { folder }) });

      if (folder !== undefined) setOpen(folder, true);

      refresh();

      return meta;
    } finally {
      creating.value = false;
    }
  }

  /** Bookmarks a folder, a note or a line; answers the bookmark. */
  async function addBookmark(ask: BookmarkAsk): Promise<NoteBookmark> {
    const made = await api.addBookmark(ask);

    await loadBookmarks();

    return made;
  }

  async function removeBookmark(id: string): Promise<void> {
    await api.removeBookmark(id);
    await loadBookmarks();
  }

  /** Bookmarks the note, or takes its bookmark off. */
  async function setNoteMarked(note: NoteMeta, marked: boolean): Promise<void> {
    const standing = noteMarks.value.get(noteKeyOf(note));

    if (marked) await addBookmark({ kind: "note", noteId: note.id, ...(note.access === "owner" ? {} : { noteOwner: note.owner }) });
    else if (standing !== undefined) await removeBookmark(standing);
  }

  /** A folder made under `parent`, or at the top, under the pack's word for a new folder, its row opening for its
   * name. */
  async function makeFolder(name: string, parent: string | null): Promise<NoteFolder> {
    const made = await api.makeFolder({ id: crypto.randomUUID(), name, parent });

    folders.value = [...folders.value, made];

    if (parent !== null) setOpen(parent, true);

    naming.value = made.id;
    void loadFolders();

    return made;
  }

  async function renameFolder(id: string, name: string): Promise<void> {
    const changed = await api.changeFolder(id, { name });

    folders.value = folders.value.map((folder) => (folder.id === id ? changed : folder));
    void loadFolders();
  }

  async function moveFolder(id: string, parent: string | null): Promise<void> {
    await api.changeFolder(id, { parent });

    if (parent !== null) setOpen(parent, true);

    await loadFolders();
  }

  async function deleteFolder(id: string): Promise<void> {
    await api.deleteFolder(id);
    delete folderRows[id];
    refresh();
  }

  /** Moves the reader's own note into a folder, or to the top. */
  async function fileNote(id: string, folder: string | null): Promise<NoteMeta> {
    const moved = await api.fileNote(id, folder);

    if (folder !== null) setOpen(folder, true);

    refresh();

    return moved;
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
    bookmarks,
    bookmarksStand,
    folders,
    foldersStand,
    folderRows,
    tree,
    noteMarks,
    folderMarks,
    lineMarks,
    naming,
    shown,
    trash,
    creating,
    load,
    loadSection,
    loadBookmarks,
    append,
    setSort,
    setFolded,
    setOpen,
    reveal,
    keep,
    refresh,
    create,
    addBookmark,
    removeBookmark,
    setNoteMarked,
    makeFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
    fileNote,
    duplicate,
    moveToTrash,
    restore,
    purge,
    commented
  };
}

export type NavigatorBoard = ReturnType<typeof useNavigator>;
