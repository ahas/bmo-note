<script setup lang="ts">
// The open note, the note region of the notes screen (`docs/design.md`, 「The console surface」, 「Editing
// and saving」): its bar — the key that brings the navigator, the note's state as one key opening its
// properties, and the pin star, the share key and the more menu — then the band a reader must act on, and
// the format bar and the BlockSuite editor in one column, the page head standing at the top of the
// document's own scroll. The note saves itself a short moment after each edit, with its plain text, and
// at once on Ctrl+S. A note in the trash opens read only under its band; a note shared with the reader
// opens as the share allows. The talk's panel is docked beside the document.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";
import PropertyList from "bmo-ui/app/components/PropertyList.vue";
import { askQuestion } from "bmo-ui/app/domain/question";

import NoteEditor from "./NoteEditor.vue";
import NoteHead from "./NoteHead.vue";
import NoteTalk from "./NoteTalk.vue";
import NoteToolbar from "./NoteToolbar.vue";
import { Refusal, Unreachable } from "../domain/api";
import { noteBlobSource } from "../domain/blobs";
import { clockOf, sizeOf } from "../domain/count";
import { SCREEN_KBDS } from "../domain/keys";
import { noteKeyOf } from "../domain/navigator";
import { plainText } from "../domain/plain";
import { holdsChange, initialSaveState, nextSaveState, versionOf } from "../domain/save";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { RouteLocationNormalized } from "vue-router";
import type { NoteApi, NoteKey } from "../domain/api";
import type { Holding } from "../domain/count";
import type { ReplaceResult } from "../domain/apply";
import type { Op } from "../domain/patch";
import type { SaveState } from "../domain/save";
import type { Note, NoteMeta } from "../../shared/types";

/** What the bar and the band ask the screen to do with the open note. */
export type NoteAct = "share" | "pin" | "unpin" | "copy" | "duplicate" | "trash" | "restore" | "purge";

const props = defineProps<{
  api: NoteApi;
  noteKey: NoteKey;
  /** The reader's own note, read from the trash. */
  trashed: boolean;
  pinned: boolean;
  /** Whether the note stands at full width in this browser. */
  wide: boolean;
  /** Whether a key brings the navigator: on a phone, or with the navigator folded. */
  navigatorKey: "drawer" | "unfold" | null;
  nameOf: (key: string) => string;
  /** Writes the open note's text where the service holds none; answers the note as it then stands. */
  fill: (note: NoteMeta, lines: readonly string[]) => Promise<NoteMeta | null>;
}>();

// `saved` tells the screen the note as it now stands: read, saved, its icon set or its text filled.
const emit = defineEmits<{ navigator: []; act: [act: NoteAct, note: NoteMeta]; wide: [wide: boolean]; saved: [note: NoteMeta] }>();

const i18n = useI18n();

const note = shallowRef<Note | null>(null);
const stand = ref<"loading" | "ready" | "missing" | "failed">("loading");
const readCount = ref(0);
const saveState = ref<SaveState>(
  initialSaveState({ id: props.noteKey.id, owner: props.noteKey.owner ?? "", title: "", version: 1, createdAt: 0, changedAt: 0, size: 0, deletedAt: null, access: "owner", icon: "", indexed: false })
);
const editor = shallowRef<InstanceType<typeof NoteEditor> | null>(null);
const holding = ref<Holding>({ words: 0 });
const talkOpen = ref(false);
const detailsOpen = ref(false);
const liveTitle = ref("");
const retrying = ref(false);
const reloading = ref(false);
const iconBusy = ref(false);

let debounce: ReturnType<typeof setTimeout> | null = null;
let unloadGuard: ((event: BeforeUnloadEvent) => void) | null = null;

const changed = computed(() => holdsChange(saveState.value));

// What the reader holds of the note: a `read` share and the trash open it read only; only the owner
// shares it and moves it to the trash.
const readonly = computed(() => props.trashed || note.value?.access === "read");
const owns = computed(() => note.value?.access === "owner");
const shared = computed(() => note.value !== null && note.value.access !== "owner");

const blobs = computed(() => noteBlobSource(props.noteKey.id, props.noteKey.owner, readonly.value));

async function read(): Promise<void> {
  stand.value = "loading";

  try {
    const found = await props.api.read(props.noteKey, { opened: !props.trashed, trashed: props.trashed });

    note.value = found;
    saveState.value = initialSaveState(found);
    liveTitle.value = found.title;
    holding.value = { words: 0 };
    readCount.value += 1;
    stand.value = "ready";
    emit("saved", found);
  } catch (error) {
    stand.value = error instanceof Refusal && error.status === 404 ? "missing" : "failed";
  }
}

onMounted(() => {
  void read();

  unloadGuard = (event: BeforeUnloadEvent) => {
    if (changed.value) event.preventDefault();
  };

  addEventListener("beforeunload", unloadGuard);
  addEventListener("keydown", saveKey, true);
});

// Ctrl+S (⌘S) saves at once in place of the browser's own save. It is caught on the way down, before the
// editor sees the key, so it holds wherever the focus stands on the screen.
function saveKey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "s") return;

  event.preventDefault();
  event.stopPropagation();

  if (debounce !== null) {
    clearTimeout(debounce);
    debounce = null;
  }

  void flush();
}

onBeforeUnmount(() => {
  if (unloadGuard !== null) removeEventListener("beforeunload", unloadGuard);

  removeEventListener("keydown", saveKey, true);

  if (debounce !== null) clearTimeout(debounce);
});

function onEdit(): void {
  if (readonly.value) return;

  saveState.value = nextSaveState(saveState.value, { type: "edited" });
  count();

  if (debounce !== null) clearTimeout(debounce);

  debounce = setTimeout(() => {
    debounce = null;
    void flush();
  }, 800);
}

/** The count of what the note holds, read from the document the editor holds. */
function count(): void {
  const exposed = editor.value as { holding?: () => Holding } | null;

  holding.value = exposed?.holding?.() ?? holding.value;
}

function snapshot(): { doc: string; title: string } | null {
  const exposed = editor.value as { snapshot?: () => { doc: string; title: string } } | null;

  return exposed?.snapshot?.() ?? null;
}

/** The note's title as the open document holds it, which the talk names it by. */
function readTitle(): void {
  liveTitle.value = snapshot()?.title ?? note.value?.title ?? "";
}

const titleLine = computed(() => {
  const title = liveTitle.value.trim();

  return title === "" ? i18n.t("note.label.untitled") : title;
});

function talkLines(): string[] {
  return editor.value?.lines() ?? [];
}

function talkApply(ops: Op[]): boolean {
  return editor.value?.apply(ops) ?? false;
}

function talkReplace(lines: string[]): ReplaceResult {
  return editor.value?.replace(lines) ?? { ok: false, kinds: [] };
}

function talkRename(title: string): boolean {
  return editor.value?.rename(title) ?? false;
}

/** The editor has drawn the note: the count and the title are read, and a note the service holds no text
 * for is given it quietly. */
async function ready(): Promise<void> {
  count();
  readTitle();
  await nextTick();
  placeHead();

  const held = note.value;

  if (held === null || readonly.value || held.indexed) return;

  const filled = await props.fill(held, talkLines());

  if (filled !== null && note.value === held) {
    note.value = { ...held, ...filled, doc: held.doc };
    emit("saved", filled);
  }
}

/** Sends what the editor holds, naming the version it was made from, with its plain text (`docs/api.md`,
 * 「Notes」). */
async function flush(): Promise<void> {
  const held = note.value;

  if (held === null || !holdsChange(saveState.value)) return;

  const before = saveState.value;

  saveState.value = nextSaveState(before, { type: "flush" });

  if (saveState.value === before) return;

  const taken = snapshot();

  try {
    const meta = await props.api.save(props.noteKey, {
      version: versionOf(saveState.value) ?? held.version,
      title: taken?.title,
      doc: taken?.doc,
      text: taken === null ? undefined : plainText(talkLines())
    });

    note.value = { ...held, ...meta, doc: held.doc };
    saveState.value = nextSaveState(saveState.value, { type: "answered", meta });
    emit("saved", meta);
  } catch (error) {
    if (error instanceof Refusal && error.status === 409 && error.note !== undefined) {
      saveState.value = nextSaveState(saveState.value, { type: "conflict", note: error.note });
    } else if (error instanceof Unreachable) {
      saveState.value = nextSaveState(saveState.value, { type: "unreachable" });
    } else {
      const code = error instanceof Refusal ? error.code : "failed";

      saveState.value = nextSaveState(saveState.value, { type: "refused", code });
    }
  }
}

async function retrySave(): Promise<void> {
  if (saveState.value.kind === "conflict" || retrying.value) return;

  retrying.value = true;
  saveState.value = nextSaveState(saveState.value, { type: "edited" });

  try {
    await flush();
  } finally {
    retrying.value = false;
  }
}

async function reloadNote(): Promise<void> {
  if (reloading.value) return;

  reloading.value = true;

  if (debounce !== null) clearTimeout(debounce);

  try {
    await read();
  } finally {
    reloading.value = false;
  }
}

// Choosing another note or leaving the screen with a change unsent sends it first; where it cannot land,
// the reader is asked. A move that keeps this note — a search opened over it — asks nothing.
function keepsThisNote(to: RouteLocationNormalized): boolean {
  const owner = typeof to.query.owner === "string" && to.query.owner !== "" ? to.query.owner : undefined;

  return to.name === "note" && String(to.params.noteId ?? "") === props.noteKey.id && owner === props.noteKey.owner && (to.query.trash === "1") === props.trashed;
}

async function guard(to: RouteLocationNormalized): Promise<boolean> {
  if (keepsThisNote(to) || !changed.value) return true;

  await flush();

  if (!changed.value) return true;

  return askQuestion({
    title: i18n.t("note.question.leave"),
    effect: i18n.t("note.question.leave_effect"),
    confirm: i18n.t("note.action.leave"),
    leaving: true
  });
}

onBeforeRouteLeave(guard);
onBeforeRouteUpdate(guard);

// The save state as the bar says it: the state's own icon, tone and word.
const saveLabel = computed(() => {
  switch (saveState.value.kind) {
    case "queued":
    case "saving":
      return i18n.t("note.label.saving");
    case "saved":
      return i18n.t("note.label.saved");
    case "conflict":
      return i18n.t("note.label.conflict");
    default:
      return i18n.t("note.label.save_failed");
  }
});

const saveIcon = computed(() => {
  switch (saveState.value.kind) {
    case "queued":
    case "saving":
      return "i-material-symbols-progress-activity";
    case "saved":
      return "i-material-symbols-check-circle-outline";
    case "conflict":
      return "i-material-symbols-warning-outline";
    case "offline":
      return "i-material-symbols-cloud-off-outline";
    default:
      return "i-material-symbols-error-outline";
  }
});

const saveTone = computed(() => {
  switch (saveState.value.kind) {
    case "conflict":
      return "text-warning";
    case "offline":
    case "refused":
      return "text-error";
    default:
      return "text-muted";
  }
});

const saveSpin = computed(() => !readonly.value && (saveState.value.kind === "queued" || saveState.value.kind === "saving"));

// A note open to read only says so where the save state would stand.
const stateIcon = computed(() => (readonly.value ? "i-material-symbols-lock-outline" : saveIcon.value));
const stateTone = computed(() => (readonly.value ? "text-muted" : saveTone.value));
const stateWord = computed(() => (readonly.value ? i18n.t("note.label.read_only") : saveLabel.value));

function momentOf(moment: number): string {
  return new Intl.DateTimeFormat(i18n.locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(moment);
}

// When the note was last edited: the clock alone today, the day and the clock before.
const editedLine = computed(() => {
  const moment = note.value?.changedAt ?? 0;
  const today = new Date().toDateString() === new Date(moment).toDateString();

  return i18n.t("note.label.edited", { time: today ? clockOf(moment, i18n.locale.value) : momentOf(moment) });
});

const sizeLine = computed(() => sizeOf(note.value?.size ?? 0, i18n.locale.value));
const wordsLine = computed(() => new Intl.NumberFormat(i18n.locale.value).format(holding.value.words));
const holdingLine = computed(() => i18n.t("note.label.holding", { words: wordsLine.value, size: sizeLine.value }));

const details = computed(() => {
  const held = note.value;

  if (held === null) return [];

  return [
    { label: i18n.t("note.label.owner"), value: shared.value ? props.nameOf(held.owner) : i18n.t("note.label.you") },
    { label: i18n.t("note.label.created"), value: momentOf(held.createdAt) },
    { label: i18n.t("note.label.changed"), value: momentOf(held.changedAt) },
    { label: i18n.t("note.label.word_count"), value: wordsLine.value },
    { label: i18n.t("note.label.size"), value: sizeLine.value }
  ];
});

function act(kind: NoteAct): void {
  if (note.value !== null) emit("act", kind, note.value);
}

const moreItems = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = [
    [
      { label: i18n.t("note.action.copy_link"), icon: "i-material-symbols-link", kbds: SCREEN_KBDS.link, onSelect: () => act("copy") },
      { label: i18n.t("note.action.duplicate"), icon: "i-material-symbols-content-copy-outline", disabled: props.trashed, onSelect: () => act("duplicate") },
      {
        label: i18n.t("note.action.full_width"),
        icon: "i-material-symbols-width-full-outline",
        type: "checkbox",
        checked: props.wide,
        onUpdateChecked: (checked: boolean) => emit("wide", checked)
      }
    ]
  ];

  if (owns.value && !props.trashed) groups.push([{ label: i18n.t("note.action.trash"), icon: "i-material-symbols-delete-outline", color: "error", onSelect: () => act("trash") }]);

  groups.push([{ label: holdingLine.value, type: "label" }]);

  return groups;
});

async function pickIcon(icon: string): Promise<void> {
  const held = note.value;

  if (held === null || iconBusy.value) return;

  iconBusy.value = true;

  try {
    const meta = await props.api.icon(props.noteKey, icon);

    note.value = { ...held, icon: meta.icon };
    emit("saved", { ...held, ...meta });
  } catch {
    // The icon stands as it stood; the head's own key is pressed again.
  } finally {
    iconBusy.value = false;
  }
}

// The page head stands at the top of the document's own scroll, before the editor's container, in an
// element of the region's own that the head is drawn into.
const headPlace = shallowRef<HTMLElement | null>(null);
const region = shallowRef<HTMLElement | null>(null);

function placeHead(): void {
  const host = region.value?.querySelector<HTMLElement>("[data-note-editor]") ?? null;

  if (host === null) return;

  let place = host.querySelector<HTMLElement>(":scope > [data-note-head-place]");

  if (place === null) {
    place = document.createElement("div");
    place.dataset.noteHeadPlace = "";
    place.style.containerType = "inline-size";
    place.style.containerName = "note-head";
    host.prepend(place);
  }

  headPlace.value = place;
}

watch(readCount, () => {
  headPlace.value = null;
});

const iconShown = computed(() => note.value?.icon ?? "");
</script>

<template>
  <div ref="region" class="flex h-full min-h-0 min-w-0 flex-1 flex-col" :style="props.wide ? { '--affine-editor-width': 'none' } : undefined" data-note-region>
    <!-- The bar: the navigator's key and the note's state at its leading end, its actions at its trailing end. -->
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-default ps-2 pe-3 sm:ps-3" data-note-bar>
      <IconButton
        v-if="props.navigatorKey !== null"
        :label="$t('note.action.list_open')"
        :kbds="props.navigatorKey === 'unfold' ? SCREEN_KBDS.navigator : undefined"
        :icon="props.navigatorKey === 'drawer' ? 'i-material-symbols-menu' : 'i-material-symbols-left-panel-open-outline'"
        size="sm"
        data-navigator-key
        @click="emit('navigator')"
      />

      <UPopover v-if="stand === 'ready' && note !== null" v-model:open="detailsOpen" :content="{ align: 'start' }">
        <UButton color="neutral" variant="ghost" size="sm" class="min-w-0 font-normal" :aria-label="$t('note.action.details')" data-note-state>
          <span class="flex min-w-0 items-center gap-1.5 text-sm tabular-nums">
            <template v-if="shared">
              <span class="min-w-0 truncate text-muted">{{ $t("note.label.shared_by", { name: props.nameOf(note.owner) }) }}</span>
              <span class="text-dimmed" aria-hidden="true">·</span>
            </template>
            <span class="shrink-0 text-muted max-sm:hidden">{{ editedLine }}</span>
            <span class="text-dimmed max-sm:hidden" aria-hidden="true">·</span>
            <span role="status" aria-live="polite" class="inline-flex shrink-0 items-center gap-1" :class="stateTone">
              <UIcon :name="stateIcon" class="size-4 shrink-0" :class="saveSpin ? 'animate-spin' : ''" />
              <span>{{ stateWord }}</span>
            </span>
          </span>
        </UButton>
        <template #content>
          <div class="w-72 max-w-[calc(100vw-2rem)] p-4">
            <PropertyList :rows="details" :title="titleLine" />
          </div>
        </template>
      </UPopover>
      <span v-else class="min-w-0 flex-1" />

      <div v-if="stand === 'ready' && note !== null" class="ms-auto flex shrink-0 items-center gap-1">
        <IconButton
          v-if="!props.trashed"
          :label="props.pinned ? $t('note.action.unpin') : $t('note.action.pin')"
          :icon="props.pinned ? 'i-material-symbols-star' : 'i-material-symbols-star-outline'"
          :class="props.pinned ? 'text-warning' : ''"
          size="sm"
          :aria-pressed="props.pinned"
          data-note-pin
          @click="act(props.pinned ? 'unpin' : 'pin')"
        />
        <IconButton v-if="owns && !props.trashed" :label="$t('note.action.share')" icon="i-material-symbols-share-outline" size="sm" data-note-share @click="act('share')" />
        <UDropdownMenu :items="moreItems" :content="{ align: 'end' }">
          <IconButton :label="$t('note.action.more')" icon="i-material-symbols-more-vert" size="sm" data-note-more />
        </UDropdownMenu>
      </div>
    </div>

    <template v-if="stand === 'loading'">
      <NoteToolbar :std="null" />
      <div role="status" :aria-label="$t('note.status.loading')" class="flex w-full flex-col gap-4 px-6 py-6">
        <USkeleton class="h-12 w-12 rounded-md" />
        <USkeleton class="h-9 w-2/5 rounded-md" />
        <div class="flex flex-col gap-2">
          <USkeleton class="h-4 w-full rounded-sm" />
          <USkeleton class="h-4 w-3/4 rounded-sm" />
          <USkeleton class="h-4 w-full rounded-sm" />
        </div>
      </div>
    </template>

    <div v-else-if="stand === 'missing'" class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <UIcon name="i-material-symbols-search-off" class="size-10 text-dimmed" />
      <p class="text-sm text-muted">{{ $t("note.status.missing") }}</p>
    </div>

    <div v-else-if="stand === 'failed'" role="alert" class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <UIcon name="i-material-symbols-error-outline" class="size-10 text-error" />
      <p class="text-sm text-error">{{ $t("note.error.read_failed") }}</p>
      <UButton color="neutral" variant="soft" icon="i-material-symbols-refresh" :label="$t('note.action.retry')" @click="read" />
    </div>

    <div v-else-if="note !== null" class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <!-- What the reader must act on stands in a band of its own, above the document. -->
        <div v-if="props.trashed" class="flex min-h-11 shrink-0 items-center gap-3 border-b border-default bg-elevated px-4 text-sm" role="status" data-trash-band>
          <UIcon name="i-material-symbols-delete-outline" class="size-5 shrink-0 text-muted max-sm:hidden" />
          <span class="min-w-0 flex-1 truncate">{{ $t("note.label.in_trash") }}</span>
          <UButton size="sm" color="neutral" variant="subtle" icon="i-material-symbols-settings-backup-restore" :label="$t('note.action.restore')" @click="act('restore')" />
          <UButton size="sm" color="error" variant="subtle" icon="i-material-symbols-delete-forever-outline" :label="$t('note.action.purge')" @click="act('purge')" />
        </div>
        <div v-else-if="saveState.kind === 'conflict'" class="flex min-h-11 shrink-0 items-center gap-3 border-b border-default bg-warning/10 px-4 text-sm" role="alert">
          <UIcon name="i-material-symbols-warning-outline" class="size-5 shrink-0 text-warning" />
          <span class="min-w-0 flex-1">{{ $t("note.status.conflict") }}</span>
          <UButton size="sm" color="neutral" variant="subtle" icon="i-material-symbols-refresh" :loading="reloading" :label="$t('note.action.reload')" @click="reloadNote" />
        </div>
        <div v-else-if="saveState.kind === 'offline' || saveState.kind === 'refused'" class="flex min-h-11 shrink-0 items-center gap-3 border-b border-default bg-error/10 px-4 text-sm text-error" role="alert">
          <UIcon :name="saveState.kind === 'offline' ? 'i-material-symbols-cloud-off-outline' : 'i-material-symbols-error-outline'" class="size-5 shrink-0" />
          <span class="min-w-0 flex-1">{{ saveState.kind === "refused" && $te(`note.error.${saveState.code}`) ? $t(`note.error.${saveState.code}`) : saveState.kind === "refused" ? $t("note.status.refused") : $t("note.status.offline") }}</span>
          <UButton size="sm" color="neutral" variant="subtle" icon="i-material-symbols-refresh" :loading="retrying" :label="$t('note.action.retry')" @click="retrySave" />
        </div>

        <NoteEditor
          :key="`${noteKeyOf(note)}-${readCount}`"
          :ref="(mount) => { editor = mount as InstanceType<typeof NoteEditor> | null }"
          :note-id="note.id"
          :doc="note.doc"
          :title="titleLine"
          :blobs="blobs"
          :readonly="readonly"
          @change="onEdit"
          @title="liveTitle = $event"
          @ready="ready"
        >
          <template v-if="!readonly" #barEnd>
            <HintTip :text="$t('note.action.talk')" press>
              <UButton size="sm" color="neutral" variant="ghost" icon="i-material-symbols-forum-outline" :label="$t('note.action.talk')" @click="talkOpen = true" />
            </HintTip>
          </template>
        </NoteEditor>

        <Teleport v-if="headPlace !== null" :to="headPlace">
          <NoteHead :icon="iconShown" :writable="!readonly" :busy="iconBusy" @pick="pickIcon" />
        </Teleport>
      </div>

      <NoteTalk v-if="!readonly" v-model:open="talkOpen" :note-id="note.id" :title="titleLine" :lines="talkLines" :apply="talkApply" :replace="talkReplace" :rename="talkRename" />
    </div>
  </div>
</template>
