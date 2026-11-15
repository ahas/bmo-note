<script setup lang="ts">
// The notes screen (`docs/design.md`, 「The console surface」): a navigator of the reader's notes beside the
// open note, one route whose screen stays standing while the address changes. Choosing a note changes the
// note region and the address, one step of the history; the navigator stands where it was. On a wide
// screen the two regions stand behind the library's splitter, the navigator folding away whole; on a phone
// the note region owns the screen and the navigator rises as a drawer from one key. The search dialog
// stands while the address carries a search. Nothing is laid into the console's title bar; where no console
// offers one, the screen draws its own, holding the screen's name alone.

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
import { createNoteApi } from "../../domain/api";
import { emptyFinding, findingOf, withFinding } from "../../domain/finding";
import { screenKeyOf, SCREEN_KBDS, typingIn } from "../../domain/keys";
import { NAVIGATOR_FIRST_PX, NAVIGATOR_MAX_PX, NAVIGATOR_MIN_PX, noteKeyOf, notePath, withWide } from "../../domain/navigator";
import { FIRST_SPAN, linkRoad, linkSpans, memberRoad } from "../../domain/share";

import type { DropdownMenuItem, SplitterItem } from "@nuxt/ui";
import type { RelayOptions } from "bmo-ui/app/domain/relay";
import type { Call, NoteKey } from "../../domain/api";
import type { Finding } from "../../domain/finding";
import type { NoteAct } from "../../components/NoteOpen.vue";
import type { NoteMeta } from "../../../shared/types";

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

const pinnedOpen = computed(() => openNote.value !== null && board.pinnedKeys.value.has(noteKeyOf(openNote.value)));
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

function choose(note: NoteMeta, newTab = false): void {
  if (newTab) {
    window.open(hrefOf(note), "_blank", "noopener");

    return;
  }

  drawerOpen.value = false;
  void router.push(notePath(note));
}

async function create(): Promise<void> {
  if (board.creating.value) return;

  try {
    const made = await board.create();

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
      case "pin":
      case "unpin":
        await board.setPinned(note, kind === "pin");
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

// A row's menu: what the reader may do to that note.
function itemsOf(note: NoteMeta): DropdownMenuItem[][] {
  const pinned = board.pinnedKeys.value.has(noteKeyOf(note));
  const owns = note.access === "owner";
  const first: DropdownMenuItem[] = [
    pinned
      ? { label: i18n.t("note.action.unpin"), icon: "i-material-symbols-star", onSelect: () => void act("unpin", note) }
      : { label: i18n.t("note.action.pin"), icon: "i-material-symbols-star-outline", onSelect: () => void act("pin", note) },
    ...(owns ? [{ label: i18n.t("note.action.share"), icon: "i-material-symbols-share-outline", onSelect: () => void act("share", note) }] : []),
    { label: i18n.t("note.action.copy_link"), icon: "i-material-symbols-link", onSelect: () => void act("copy", note) },
    { label: i18n.t("note.action.duplicate"), icon: "i-material-symbols-content-copy-outline", onSelect: () => void act("duplicate", note) }
  ];

  return owns ? [first, [{ label: i18n.t("note.action.trash"), icon: "i-material-symbols-delete-outline", color: "error", onSelect: () => void act("trash", note) }]] : [first];
}

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
            :pinned="pinnedOpen"
            :wide="wideOpen"
            navigator-key="drawer"
            :name-of="nameOf"
            :fill="board.fill.fillOpen"
            @navigator="drawerOpen = true"
            @act="act"
            @wide="setWide"
            @saved="regionSaved"
          />
          <div v-else class="flex min-w-0 flex-1 flex-col">
            <div class="flex h-12 shrink-0 items-center border-b border-default ps-2 pe-3" data-note-bar>
              <UButton color="neutral" variant="ghost" size="sm" icon="i-material-symbols-menu" :label="$t('note.label.list')" data-navigator-key @click="drawerOpen = true" />
            </div>
            <div class="flex flex-1 flex-col items-center justify-center gap-3 px-4 pb-[var(--bmo-create-room)] text-center" data-note-empty>
              <UIcon name="i-material-symbols-edit-note-outline" class="size-10 text-dimmed" />
              <p class="text-sm text-muted">{{ $t("note.empty.open") }}</p>
            </div>
            <CreateButton :label="$t('note.action.new')" :loading="board.creating.value" @click="create" />
          </div>
        </div>

        <UDrawer v-model:open="drawerOpen" :title="$t('note.label.list')" :ui="{ ...FULL_SHEET, header: 'sr-only' }">
          <template #body>
            <NoteNavigator :board="board" :chosen="chosenMark" drawn :items-of="itemsOf" :href-of="hrefOf" @open="(note, event) => choose(note, event.ctrlKey || event.metaKey)" @create="create" @search="openSearch" />
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
          <NoteNavigator :board="board" :chosen="chosenMark" :drawn="false" :items-of="itemsOf" :href-of="hrefOf" @open="(note, event) => choose(note, event.ctrlKey || event.metaKey)" @create="create" @search="openSearch" @fold="toggleNavigator" />
        </template>
        <template #note>
          <NoteOpen
            v-if="chosenKey !== null"
            :key="regionKey"
            :api="api"
            :note-key="{ id: chosenKey.id, owner: chosenKey.owner }"
            :trashed="chosenKey.trashed"
            :pinned="pinnedOpen"
            :wide="wideOpen"
            :navigator-key="navigatorKey"
            :name-of="nameOf"
            :fill="board.fill.fillOpen"
            @navigator="toggleNavigator"
            @act="act"
            @wide="setWide"
            @saved="regionSaved"
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
