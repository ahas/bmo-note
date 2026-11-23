<script setup lang="ts">
// The notes screen (`docs/design.md`, 「The console surface」): a navigator of the reader's notes beside the
// open note, one route whose screen stays standing while the address changes. Choosing a note changes the
// note region and the address, one step of the history; the navigator stands where it was. On a wide
// screen the two regions stand behind the library's splitter, the navigator folding away whole; on a phone
// the note region owns the screen and the navigator rises as a drawer from one key. The search dialog
// stands while the address carries a search. Nothing is laid into the console's title bar; where no console
// offers one, the screen draws its own, holding the screen's name alone. The reader's folders, their bookmarks
// and what a row dragged onto a folder does are answered here, each on the message pill where it fails.

import { computed, inject, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import CreateButton from "bmo-ui/app/components/CreateButton.vue";
import ShareDialog from "bmo-ui/app/components/ShareDialog.vue";
import { copyText } from "bmo-ui/app/domain/clipboard";
import { useIsland } from "bmo-ui/app/domain/island";
import { askQuestion } from "bmo-ui/app/domain/question";
import { relayCall } from "bmo-ui/app/domain/relay";
import { useNarrow } from "bmo-ui/app/domain/screen";
import { FULL_SHEET, SPLIT_HANDLE } from "bmo-ui/app/domain/side-parts";

import NoteNavigator from "../../components/NoteNavigator.vue";
import NoteOpen from "../../components/NoteOpen.vue";
import NoteSearch from "../../components/NoteSearch.vue";
import { useNavigator } from "../../composables/useNavigator";
import { useOwnerNames } from "../../composables/useOwnerNames";
import { createNoteApi, Refusal } from "../../domain/api";
import { emptyFinding, findingOf, withFinding } from "../../domain/finding";
import { screenKeyOf, SCREEN_KBDS, typingIn } from "../../domain/keys";
import { folderOrder, holdsFolder, NAVIGATOR_FIRST_PX, NAVIGATOR_MAX_PX, NAVIGATOR_MIN_PX, noteKeyOf, notePath, withWide } from "../../domain/navigator";
import { FIRST_SPAN, linkRoad, linkSpans, memberRoad } from "../../domain/share";

import type { DropdownMenuItem, SplitterItem } from "@nuxt/ui";
import type { RelayOptions } from "bmo-ui/app/domain/relay";
import type { Call, NoteKey } from "../../domain/api";
import type { Finding } from "../../domain/finding";
import type { HeldRow } from "../../domain/drag";
import type { NavigatorActs } from "../../components/NoteNavigator.vue";
import type { LineAsk, NoteAct } from "../../components/NoteOpen.vue";
import type { NoteBookmark, NoteFolder, NoteMeta } from "../../../shared/types";

const SERVICE = "note";

const i18n = useI18n();
const route = useRoute();
const router = useRouter();
const island = useIsland((key: string) => i18n.t(key));
const api = createNoteApi(<T>(path: string, options?: Parameters<Call>[1]) => relayCall<T>(SERVICE, path, options as RelayOptions));
const board = useNavigator(api, SERVICE);
const { people, nameOf } = useOwnerNames();
const narrow = useNarrow();

// The console's bar, where it offers one: it names the screen, so this one draws no bar of its own.
const consoleBar = inject<object | null>("bmo-console-title-bar", null);

// The note the address names: its id, its owner where it is another's, and whether it is read from the trash.
const chosenKey = computed<(NoteKey & { trashed: boolean }) | null>(() => {
  const id = String(route.params.noteId ?? "");

  if (id === "") return null;

  const owner = typeof route.query.owner === "string" && route.query.owner !== "" ? route.query.owner : undefined;

  return { id, owner, trashed: route.query.trash === "1" };
});

// The region is keyed by the note the address names; the navigator marks the note the region holds, once
// it is read, or the one another account's key names while it is read.
const regionKey = computed(() => (chosenKey.value === null ? "" : `${chosenKey.value.owner ?? ""}/${chosenKey.value.id}/${chosenKey.value.trashed}`));

// The note the region holds, as it last stood: what its bar's actions and the share dialog act on.
const openNote = ref<NoteMeta | null>(null);

watch(regionKey, () => {
  openNote.value = null;
});

const chosenMark = computed(() => {
  if (openNote.value !== null) return noteKeyOf(openNote.value);

  return chosenKey.value?.owner === undefined ? null : `${chosenKey.value.owner}/${chosenKey.value.id}`;
});

const bookmarkedOpen = computed(() => openNote.value !== null && board.noteMarks.value.has(noteKeyOf(openNote.value)));
const openLines = computed(() => (openNote.value === null ? new Map<string, string>() : (board.lineMarks.value.get(noteKeyOf(openNote.value)) ?? new Map<string, string>())));
const markedLines = computed(() => [...openLines.value.keys()]);

// A line a bookmark asked to bring into sight, for the note it stands in; each ask a turn of its own.
const lineAsk = ref<{ key: string; block: string; turn: number } | null>(null);
const lineOpen = computed(() => (lineAsk.value !== null && lineAsk.value.key === regionKey.value ? { block: lineAsk.value.block, turn: lineAsk.value.turn } : null));
const wideOpen = computed(() => openNote.value !== null && board.prefs.value.wide.includes(noteKeyOf(openNote.value)));

// The splitter's navigator panel, and whether it stands folded.
const ITEMS: SplitterItem[] = [
  { slot: "navigator", sizeUnit: "px", minSize: NAVIGATOR_MIN_PX, maxSize: NAVIGATOR_MAX_PX, defaultSize: NAVIGATOR_FIRST_PX, collapsible: true, collapsedSize: 0 },
  { slot: "note" }
];
const splitter = useTemplateRef<{ panelsRef: { collapse: () => void; expand: () => void; isCollapsed: boolean }[] }>("splitter");
const folded = ref(false);
const drawerOpen = ref(false);

function toggleNavigator(): void {
  if (narrow.value) {
    drawerOpen.value = !drawerOpen.value;

    return;
  }

  const panel = splitter.value?.panelsRef[0];

  if (panel === undefined) return;

  if (panel.isCollapsed) panel.expand();
  else panel.collapse();
}

const navigatorKey = computed<"drawer" | "unfold" | null>(() => (narrow.value ? "drawer" : folded.value ? "unfold" : null));

// Choosing a note: one step of the history, the navigator standing; Ctrl or ⌘ held opens it in a new tab.
function hrefOf(note: Pick<NoteMeta, "id" | "owner" | "access" | "deletedAt">): string {
  return router.resolve(notePath(note)).href;
}

/** Opens a path a note link or a backlink names, as choosing a note does. */
function openPath(path: string, newTab: boolean): void {
  if (newTab) {
    window.open(router.resolve(path).href, "_blank", "noopener");

    return;
  }

  void router.push(path);
}

// The reader's own account key, read off any note the reader owns, for the note links that name it.
const readerKey = computed<string | null>(() => {
  const owned = [openNote.value, ...board.sections.mine.rows, ...board.bookmarks.value.map((one) => one.note)].find((note) => note !== null && note.access === "owner");

  return owned?.owner ?? null;
});

function choose(note: NoteMeta, newTab = false): void {
  if (newTab) {
    window.open(hrefOf(note), "_blank", "noopener");

    return;
  }

  drawerOpen.value = false;
  void router.push(notePath(note));
}

async function create(folder?: string): Promise<void> {
  if (board.creating.value) return;

  try {
    const made = await board.create(folder);

    drawerOpen.value = false;
    await router.push(notePath(made));
  } catch {
    island.say({ tone: "error", title: i18n.t("note.error.create_failed") });
  }
}

// The search, standing while the address carries one. Opening it is one step of the history; typing and
// filtering rewrite that step; closing steps back over it where the screen took it, and takes the search
// out of the address where the address came with it.
const finding = computed(() => findingOf(route.query));
let searchStepTaken = false;

function openSearch(): void {
  if (finding.value !== null) return;

  drawerOpen.value = false;
  searchStepTaken = true;
  void router.push({ query: withFinding(route.query, emptyFinding()) });
}

function changeSearch(next: Finding): void {
  void router.replace({ query: withFinding(route.query, next) });
}

function closeSearch(): void {
  if (finding.value === null) return;

  if (searchStepTaken) {
    searchStepTaken = false;
    router.back();
  } else {
    void router.replace({ query: withFinding(route.query, null) });
  }
}

function openFound(note: NoteMeta, newTab: boolean): void {
  if (newTab) {
    window.open(hrefOf(note), "_blank", "noopener");

    return;
  }

  searchStepTaken = false;
  void router.replace(notePath(note));
}

// The share dialog: one for the screen, on the note a row or the open note's bar asked it for.
const shareNote = ref<NoteMeta | null>(null);
const shareOpen = ref(false);
const shareRoad = computed(() => (shareNote.value === null ? null : linkRoad(api, shareNote.value.id)));
const shareMembers = computed(() => (shareNote.value === null || people === null ? undefined : memberRoad(api, people, shareNote.value.id)));
const shareSpans = computed(() => linkSpans((key) => i18n.t(key)));

function titleOf(note: NoteMeta): string {
  return note.title === "" ? i18n.t("note.label.untitled") : note.title;
}

async function copyLink(note: NoteMeta): Promise<void> {
  const copied = await copyText(new URL(hrefOf(note), location.href).href);

  island.say(copied ? { tone: "success", title: i18n.t("note.status.copied") } : { tone: "error", title: i18n.t("note.error.copy_failed") });
}

async function act(kind: NoteAct, note: NoteMeta): Promise<void> {
  try {
    switch (kind) {
      case "share":
        shareNote.value = note;
        shareOpen.value = true;
        break;
      case "bookmark":
      case "unbookmark":
        await board.setNoteMarked(note, kind === "bookmark");
        break;
      case "copy":
        await copyLink(note);
        break;
      case "duplicate": {
        const copy = await board.duplicate(note, i18n.t("note.label.copy_of", { title: titleOf(note) }));

        island.say({ tone: "success", title: i18n.t("note.status.duplicated") });
        await router.push(notePath(copy));
        break;
      }
      case "trash":
        await board.moveToTrash(note);

        if (openNote.value !== null && noteKeyOf(openNote.value) === noteKeyOf(note)) await router.push("/note");

        island.say({ tone: "success", title: i18n.t("note.status.trashed"), actions: [{ label: i18n.t("note.action.restore"), press: () => act("restore", note) }] });
        break;
      case "restore":
        await board.restore(note);
        island.say({ tone: "success", title: i18n.t("note.status.restored") });

        if (chosenKey.value?.trashed === true && chosenKey.value.id === note.id) await router.replace(notePath({ ...note, deletedAt: null }));
        break;
      case "purge":
        if (!(await askQuestion({ title: i18n.t("note.question.purge"), item: titleOf(note), effect: i18n.t("note.question.purge_effect"), confirm: i18n.t("note.action.purge") }))) return;

        await board.purge(note);
        island.say({ tone: "success", title: i18n.t("note.status.purged") });

        if (chosenKey.value?.id === note.id) await router.replace("/note");
        break;
    }
  } catch {
    island.say({ tone: "error", title: i18n.t("note.error.action_failed") });
  }
}

// The places a row can be moved to: the top, then every folder by its place in the tree, the one it stands in
// marked; a folder never offers itself nor a folder it holds.
const DEPTH_INSET = ["", "ps-6", "ps-10", "ps-14", "ps-18", "ps-22", "ps-26", "ps-30"];

function placesFor(row: HeldRow, standing: string | null): DropdownMenuItem[][] {
  const folders = folderOrder(board.tree.value).filter((node) => row.kind === "note" || !holdsFolder(board.folders.value, row.id, node.folder.id));
  const place = (folder: string | null): DropdownMenuItem => ({
    type: "checkbox",
    checked: standing === folder,
    onSelect: () => void dropRow(folder, row)
  });

  return [
    [{ ...place(null), label: i18n.t("note.folder.top"), icon: "i-material-symbols-home-outline" }],
    ...(folders.length === 0
      ? []
      : [folders.map((node) => ({ ...place(node.folder.id), label: node.folder.name, icon: "i-material-symbols-folder-outline", class: DEPTH_INSET[Math.min(node.depth, DEPTH_INSET.length - 1)] }))])
  ];
}

// A row's menu: what the reader may do to that note.
function itemsOf(note: NoteMeta): DropdownMenuItem[][] {
  const marked = board.noteMarks.value.has(noteKeyOf(note));
  const owns = note.access === "owner";
  const first: DropdownMenuItem[] = [
    marked
      ? { label: i18n.t("note.action.unbookmark"), icon: "i-material-symbols-bookmark", onSelect: () => void act("unbookmark", note) }
      : { label: i18n.t("note.action.bookmark"), icon: "i-material-symbols-bookmark-outline", onSelect: () => void act("bookmark", note) },
    ...(owns ? [{ label: i18n.t("note.action.share"), icon: "i-material-symbols-share-outline", onSelect: () => void act("share", note) }] : []),
    { label: i18n.t("note.action.copy_link"), icon: "i-material-symbols-link", onSelect: () => void act("copy", note) },
    { label: i18n.t("note.action.duplicate"), icon: "i-material-symbols-content-copy-outline", onSelect: () => void act("duplicate", note) },
    ...(owns ? [{ label: i18n.t("note.action.move_to"), icon: "i-material-symbols-drive-file-move-outline", children: placesFor({ kind: "note", id: note.id }, note.folder) }] : [])
  ];

  return owns ? [first, [{ label: i18n.t("note.action.trash"), icon: "i-material-symbols-delete-outline", color: "error", onSelect: () => void act("trash", note) }]] : [first];
}

// ---------------------------------------------------------------------------------------------------------
// Folders and bookmarks (`docs/design.md`, 「Folders」, 「Bookmarks」)

function failed(key = "note.error.folder_failed") {
  return (error: unknown) => {
    const code = error instanceof Refusal ? error.code : "";

    island.say({ tone: "error", title: i18n.t(code === "too-deep" ? "note.error.too_deep" : code === "folder-cycle" ? "note.error.folder_cycle" : key) });
  };
}

function newFolder(parent: string | null): void {
  board.makeFolder(i18n.t("note.folder.new_name"), parent).catch(failed());
}

function nameFolder(folder: NoteFolder, name: string | null): void {
  board.naming.value = null;

  if (name !== null) board.renameFolder(folder.id, name).catch(failed());
}

async function deleteFolder(folder: NoteFolder): Promise<void> {
  if (!(await askQuestion({ title: i18n.t("note.question.delete_folder"), item: folder.name, effect: i18n.t("note.question.delete_folder_effect"), confirm: i18n.t("note.action.delete") }))) return;

  try {
    await board.deleteFolder(folder.id);
    island.say({ tone: "success", title: i18n.t("note.status.folder_deleted") });
  } catch (error) {
    failed()(error);
  }
}

/** A row moved into a folder, or to the top, by a drag or by its menu's move to. */
async function dropRow(folder: string | null, row: HeldRow): Promise<void> {
  try {
    if (row.kind === "note") {
      const moved = await board.fileNote(row.id, folder);

      if (openNote.value !== null && openNote.value.access === "owner" && openNote.value.id === moved.id) openNote.value = { ...openNote.value, folder: moved.folder };
    } else {
      if (row.id === folder) return;

      await board.moveFolder(row.id, folder);
    }

    island.say({ tone: "success", title: i18n.t("note.status.moved") });
  } catch (error) {
    failed()(error);
  }
}

function folderItemsOf(folder: NoteFolder): DropdownMenuItem[][] {
  const marked = board.folderMarks.value.get(folder.id);

  return [
    [
      { label: i18n.t("note.action.new"), icon: "i-material-symbols-add", onSelect: () => void create(folder.id) },
      { label: i18n.t("note.action.new_folder"), icon: "i-material-symbols-create-new-folder-outline", onSelect: () => newFolder(folder.id) }
    ],
    [
      { label: i18n.t("note.action.rename"), icon: "i-material-symbols-edit-outline", kbds: ["F2"], onSelect: () => (board.naming.value = folder.id) },
      { label: i18n.t("note.action.move_to"), icon: "i-material-symbols-drive-file-move-outline", children: placesFor({ kind: "folder", id: folder.id }, folder.parent) },
      marked === undefined
        ? { label: i18n.t("note.action.bookmark"), icon: "i-material-symbols-bookmark-outline", onSelect: () => void board.addBookmark({ kind: "folder", folderId: folder.id }).catch(failed("note.error.bookmark_failed")) }
        : { label: i18n.t("note.action.unbookmark"), icon: "i-material-symbols-bookmark", onSelect: () => void board.removeBookmark(marked).catch(failed("note.error.bookmark_failed")) }
    ],
    [{ label: i18n.t("note.action.delete"), icon: "i-material-symbols-delete-outline", color: "error", kbds: ["delete"], onSelect: () => void deleteFolder(folder) }]
  ];
}

function folderKey(folder: NoteFolder, key: "rename" | "delete"): void {
  if (key === "rename") board.naming.value = folder.id;
  else void deleteFolder(folder);
}

function bookmarkHref(bookmark: NoteBookmark): string | null {
  return bookmark.note === null ? null : hrefOf(bookmark.note);
}

let lineTurn = 0;

function openBookmark(bookmark: NoteBookmark, event: MouseEvent): void {
  if (bookmark.kind === "folder") {
    if (bookmark.folder !== null) board.reveal(bookmark.folder.id);

    return;
  }

  const note = bookmark.note;

  if (note === null) return;

  const newTab = event.ctrlKey || event.metaKey;

  if (bookmark.kind === "line" && !newTab) {
    if (!bookmark.anchored) island.say({ tone: "error", title: i18n.t("note.status.line_gone") });
    else lineAsk.value = { key: `${note.access === "owner" ? "" : note.owner}/${note.id}/false`, block: bookmark.block ?? "", turn: (lineTurn += 1) };
  }

  choose(note, newTab);
}

function bookmarkItemsOf(bookmark: NoteBookmark): DropdownMenuItem[][] {
  const note = bookmark.note;

  return [
    ...(note === null ? [] : [[{ label: i18n.t("note.search.new_tab"), icon: "i-material-symbols-open-in-new", onSelect: () => choose(note, true) }]]),
    [{ label: i18n.t("note.action.unbookmark"), icon: "i-material-symbols-bookmark-remove-outline", onSelect: () => void board.removeBookmark(bookmark.id).catch(failed("note.error.bookmark_failed")) }]
  ];
}

/** A line of the open note bookmarked, or its bookmark taken off where it stands. */
async function markLine(line: LineAsk): Promise<void> {
  const note = openNote.value;

  if (note === null) return;

  const standing = openLines.value.get(line.block);

  try {
    if (standing !== undefined) await board.removeBookmark(standing);
    else await board.addBookmark({ kind: "line", noteId: note.id, ...(note.access === "owner" ? {} : { noteOwner: note.owner }), block: line.block, quote: line.quote });
  } catch (error) {
    failed("note.error.bookmark_failed")(error);
  }
}

const acts: NavigatorActs = {
  folderItemsOf,
  bookmarkItemsOf,
  bookmarkHref,
  openBookmark,
  nameFolder,
  dropRow: (folder, row) => void dropRow(folder, row),
  folderKey,
  newFolder: () => newFolder(null),
  get roomItems() {
    return [
      [
        { label: i18n.t("note.action.new"), icon: "i-material-symbols-add", onSelect: () => void create() },
        { label: i18n.t("note.action.new_folder"), icon: "i-material-symbols-create-new-folder-outline", onSelect: () => newFolder(null) }
      ]
    ];
  }
};

function setWide(wide: boolean): void {
  if (openNote.value !== null) board.keep(withWide(board.prefs.value, noteKeyOf(openNote.value), wide));
}

function regionSaved(meta: NoteMeta): void {
  openNote.value = meta;
}

// The screen's keys, caught on the way down before the editor sees them.
function screenKey(event: KeyboardEvent): void {
  const asked = screenKeyOf(event, typingIn(event.target));

  if (asked === null) return;

  event.preventDefault();
  event.stopPropagation();

  if (asked === "search") openSearch();
  else if (asked === "navigator") toggleNavigator();
  else if (openNote.value !== null) void copyLink(openNote.value);
}

onMounted(() => {
  void board.load();
  addEventListener("keydown", screenKey, true);
});

onBeforeUnmount(() => removeEventListener("keydown", screenKey, true));

const searchKbds = SCREEN_KBDS.search;
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-default" data-note-screen>
    <div v-if="consoleBar === null" class="flex h-12 shrink-0 items-center border-b border-default px-4" data-screen-bar>
      <h1 class="text-xl font-semibold text-highlighted">{{ $t("note.title") }}</h1>
    </div>

    <div class="flex min-h-0 flex-1" data-screen-fill>
      <template v-if="narrow">
        <div class="flex min-h-0 min-w-0 flex-1">
          <NoteOpen
            v-if="chosenKey !== null"
            :key="regionKey"
            :api="api"
            :note-key="{ id: chosenKey.id, owner: chosenKey.owner }"
            :trashed="chosenKey.trashed"
            :bookmarked="bookmarkedOpen"
            :marked-lines="markedLines"
            :line="lineOpen"
            :wide="wideOpen"
            navigator-key="drawer"
            :name-of="nameOf"
            :reader-key="readerKey"
            :commented="board.commented.value"
            :href-of="hrefOf"
            @open="openPath"
            @navigator="drawerOpen = true"
            @act="act"
            @wide="setWide"
            @saved="regionSaved"
            @line="markLine"
          />
          <div v-else class="flex min-w-0 flex-1 flex-col">
            <div class="flex h-12 shrink-0 items-center border-b border-default ps-2 pe-3" data-note-bar>
              <UButton color="neutral" variant="ghost" size="sm" icon="i-material-symbols-menu" :label="$t('note.label.list')" data-navigator-key @click="drawerOpen = true" />
            </div>
            <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-[var(--bmo-create-room)] text-center" data-note-empty>
              <UIcon name="i-material-symbols-edit-note-outline" class="size-10 text-dimmed" />
              <p class="text-sm text-muted">{{ $t("note.empty.open") }}</p>
            </div>
            <CreateButton :label="$t('note.action.new')" :loading="board.creating.value" @click="create()" />
          </div>
        </div>

        <UDrawer v-model:open="drawerOpen" :title="$t('note.label.list')" :ui="{ ...FULL_SHEET, header: 'sr-only' }">
          <template #body>
            <NoteNavigator :board="board" :chosen="chosenMark" drawn :items-of="itemsOf" :href-of="hrefOf" :acts="acts" @open="(note, event) => choose(note, event.ctrlKey || event.metaKey)" @create="create()" @search="openSearch" />
          </template>
        </UDrawer>
      </template>

      <USplitter
        v-else
        id="note-splitter"
        ref="splitter"
        auto-save-id="bmo-note-navigator"
        :items="ITEMS"
        :ui="{ handle: SPLIT_HANDLE }"
        class="min-h-0 min-w-0 flex-1"
        @collapse="folded = true"
        @expand="folded = false"
      >
        <template #navigator>
          <NoteNavigator :board="board" :chosen="chosenMark" :drawn="false" :items-of="itemsOf" :href-of="hrefOf" :acts="acts" @open="(note, event) => choose(note, event.ctrlKey || event.metaKey)" @create="create()" @search="openSearch" @fold="toggleNavigator" />
        </template>
        <template #note>
          <NoteOpen
            v-if="chosenKey !== null"
            :key="regionKey"
            :api="api"
            :note-key="{ id: chosenKey.id, owner: chosenKey.owner }"
            :trashed="chosenKey.trashed"
            :bookmarked="bookmarkedOpen"
            :marked-lines="markedLines"
            :line="lineOpen"
            :wide="wideOpen"
            :navigator-key="navigatorKey"
            :name-of="nameOf"
            :reader-key="readerKey"
            :commented="board.commented.value"
            :href-of="hrefOf"
            @open="openPath"
            @navigator="toggleNavigator"
            @act="act"
            @wide="setWide"
            @saved="regionSaved"
            @line="markLine"
          />
          <div v-else class="flex min-w-0 flex-1 flex-col">
            <div class="flex h-12 shrink-0 items-center border-b border-default ps-2 pe-3" data-note-bar>
              <UButton v-if="folded" color="neutral" variant="ghost" size="sm" icon="i-material-symbols-left-panel-open-outline" :label="$t('note.action.list_open')" data-navigator-key @click="toggleNavigator" />
            </div>
            <div class="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center" data-note-empty>
              <UIcon name="i-material-symbols-edit-note-outline" class="size-10 text-dimmed" />
              <p class="text-sm text-muted">{{ $t("note.empty.open") }}</p>
              <div class="flex items-center gap-4 text-sm text-muted">
                <span class="flex items-center gap-1.5">{{ $t("note.action.search") }}<UKbd v-for="kbd in searchKbds" :key="kbd" :value="kbd" size="sm" /></span>
                <span class="flex items-center gap-1.5">{{ $t("note.action.new") }}<UKbd value="n" size="sm" /></span>
              </div>
            </div>
          </div>
        </template>
      </USplitter>
    </div>

    <NoteSearch :finding="finding" :api="api" :name-of="nameOf" @change="changeSearch" @close="closeSearch" @open="openFound" />

    <ShareDialog
      v-if="shareRoad !== null"
      v-model:open="shareOpen"
      :road="shareRoad"
      :spans="shareSpans"
      :span="FIRST_SPAN"
      :members="shareMembers"
      :subject="shareNote === null ? '' : titleOf(shareNote)"
    />
  </div>
</template>
