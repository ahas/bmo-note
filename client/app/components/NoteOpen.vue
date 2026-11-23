<script setup lang="ts">
// The open note, the note region of the notes screen (`docs/design.md`, 「The console surface」, 「Editing
// and saving」): its bar — the key that brings the navigator, the note's state as one key opening its
// properties, and the bookmark key, the share key and the more menu — then the band a reader must act on, and
// the format bar and the editor in one column, the page head standing at the top of the document's own
// scroll and the backlinks under it. The note saves itself a short moment after each edit, and at once on
// Ctrl+S. A note in the trash opens read only under its band; a note shared with the reader opens as the
// share allows. The talk stands in the column beside the document; a comment opens in the flow of the note, under
// its words. A line opened from its bookmark is scrolled into sight and marked a moment.

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";
import PropertyList from "bmo-ui/app/components/PropertyList.vue";
import { useBackClose } from "bmo-ui/app/domain/layers";
import { useIsland } from "bmo-ui/app/domain/island";
import { askQuestion } from "bmo-ui/app/domain/question";

import NoteBacklinks from "./NoteBacklinks.vue";
import NoteCommentGap from "./NoteCommentGap.vue";
import NoteCommentList from "./NoteCommentList.vue";
import NoteEditor from "./NoteEditor.vue";
import NoteHead from "./NoteHead.vue";
import NoteTalk from "./NoteTalk.vue";
import NoteToolbar from "./NoteToolbar.vue";
import { useComments } from "../composables/useComments";
import { Refusal, Unreachable } from "../domain/api";
import { noteBlobSource } from "../domain/blobs";
import { clockOf, sizeOf } from "../domain/count";
import { SCREEN_KBDS } from "../domain/keys";
import { candidateOf, linkCandidates, linkPath } from "../domain/links";
import { noteKeyOf } from "../domain/navigator";
import { holdsChange, initialSaveState, nextSaveState, versionOf } from "../domain/save";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { RouteLocationNormalized } from "vue-router";
import type { LinkCandidate } from "./NoteEditor.vue";
import type { Draft } from "../composables/useComments";
import type { AgentAsk } from "../domain/api";
import type { GapTarget } from "../domain/extensions";
import type { NoteApi, NoteKey } from "../domain/api";
import type { Holding } from "../domain/count";
import type { LinkTarget } from "../domain/links";
import type { Op } from "../domain/patch";
import type { Rewrite } from "../domain/rows";
import type { SaveState } from "../domain/save";
import type { NoteStreamEvent } from "../domain/stream";
import type { Note, NoteMeta } from "../../shared/types";

/** What the bar and the band ask the screen to do with the open note. */
export type NoteAct = "share" | "bookmark" | "unbookmark" | "copy" | "duplicate" | "trash" | "restore" | "purge";

/** A line bookmarked or its bookmark taken off: its block id and its words. */
export interface LineAsk {
  block: string;
  quote: string;
}

const props = defineProps<{
  api: NoteApi;
  noteKey: NoteKey;
  /** The reader's own note, read from the trash. */
  trashed: boolean;
  /** Whether the reader bookmarked the note. */
  bookmarked: boolean;
  /** The block ids of the lines the reader bookmarked in it. */
  markedLines: readonly string[];
  /** A line to bring into sight, asked again by a new turn. */
  line: { block: string; turn: number } | null;
  /** Whether the note stands at full width in this browser. */
  wide: boolean;
  /** Whether a key brings the navigator: on a phone, or with the navigator folded. */
  navigatorKey: "drawer" | "unfold" | null;
  nameOf: (key: string) => string;
  /** The reader's own account key, where the screen knows it. */
  readerKey: string | null;
  /** The latest `note.commented` event the screen heard. */
  commented: NoteStreamEvent | null;
  /** Where a note's row leads, as an address the browser can open in a new tab. */
  hrefOf: (note: NoteMeta) => string;
}>();

// `saved` tells the screen the note as it now stands: read, saved or its icon set. `open` asks the screen to
// open a note a link or a backlink names.
const emit = defineEmits<{
  navigator: [];
  act: [act: NoteAct, note: NoteMeta];
  wide: [wide: boolean];
  saved: [note: NoteMeta];
  open: [path: string, newTab: boolean];
  line: [line: LineAsk];
}>();

const i18n = useI18n();
const island = useIsland((key: string) => i18n.t(key));

const note = shallowRef<Note | null>(null);
const stand = ref<"loading" | "ready" | "missing" | "failed">("loading");
const readCount = ref(0);
const saveState = ref<SaveState>(
  initialSaveState({ id: props.noteKey.id, owner: props.noteKey.owner ?? "", title: "", version: 1, createdAt: 0, changedAt: 0, size: 0, deletedAt: null, access: "owner", icon: "", folder: null })
);
const editor = shallowRef<InstanceType<typeof NoteEditor> | null>(null);
const holding = ref<Holding>({ words: 0 });
const talkOpen = ref(false);
// What the comment gap stands open under: a new thread's words, or a thread's.
const gap = ref<GapTarget>(null);
const chosenThread = computed(() => (gap.value !== null && "thread" in gap.value ? gap.value.thread : null));
const backlinks = shallowRef<NoteMeta[]>([]);
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

// The comments: started, answered and resolved by whoever writes the note, read by every member.
const comments = useComments(
  props.api,
  () => props.noteKey,
  () => editor.value
);

watch(
  () => props.commented,
  (event) => {
    if (event === null || note.value === null) return;
    if (event.data.noteId === note.value.id && event.data.owner === note.value.owner) void comments.load();
  }
);

// A new thread's field opens under the words chosen; marked words pressed, or a thread chosen from the list, open
// that thread under its words; a closed gap drops a field never sent.
function draftComment(draft: Draft): void {
  comments.draft.value = draft;
  gap.value = { draft: draft.range };
}

function openThread(thread: string): void {
  comments.draft.value = null;
  gap.value = { thread };
}

function closeGap(): void {
  comments.draft.value = null;
  gap.value = null;
}

// The gap is a state the note went into: the back gesture closes it, as it does what stands over the screen.
useBackClose(
  computed(() => gap.value !== null),
  closeGap
);

// The Agent, asked over the open note under the reader's own account (`docs/api.md`, 「Agent」).
function askAgent(ask: AgentAsk): Promise<string | null> {
  return props.api.agent(props.noteKey, ask);
}

// The note links: where one leads, the notes the menus offer, and the press that opens one.
function linkHref(target: LinkTarget): string {
  return linkPath(target, props.readerKey);
}

async function findNotes(term: string): Promise<LinkCandidate[]> {
  const found = await linkCandidates(props.api, term);

  return found.map((one) => candidateOf(one, i18n.t("note.label.untitled"), props.nameOf));
}

function openLink(target: LinkTarget, newTab: boolean): void {
  emit("open", linkPath(target, props.readerKey), newTab);
}

function openBacklink(linking: NoteMeta, newTab: boolean): void {
  emit("open", props.hrefOf(linking), newTab);
}

async function readBacklinks(): Promise<void> {
  if (props.trashed) return;

  try {
    backlinks.value = await props.api.backlinks(props.noteKey);
  } catch {
    // The list stands empty; the note itself reads on.
  }
}

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
    void comments.load();
    void readBacklinks();
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
  comments.placesChanged();

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

function snapshot(): { doc: Note["doc"]; title: string } | null {
  return editor.value?.snapshot() ?? null;
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

function talkReplace(lines: string[]): Rewrite {
  return editor.value?.replace(lines) ?? { ok: false, kinds: [] };
}

function talkRename(title: string): boolean {
  return editor.value?.rename(title) ?? false;
}

// Whether the editor has drawn the note, so a line asked for can be found in it.
const drawn = ref(false);

/** The editor has drawn the note: the count, the title and the places of the comment marks are read, and a line
 * asked for is brought into sight. */
function ready(): void {
  count();
  readTitle();
  comments.placesChanged();
  drawn.value = true;
}

// A line asked for from its bookmark, once the editor has drawn the note; a line gone says so.
let shownTurn = -1;

watch(
  [() => props.line, drawn],
  ([line, isDrawn]) => {
    if (line === null || !isDrawn || line.turn === shownTurn) return;

    shownTurn = line.turn;

    if (editor.value?.showLine(line.block) !== true) island.say({ tone: "error", title: i18n.t("note.status.line_gone") });
  },
  { flush: "post" }
);

/** Bookmarks the line at `pos`, or under the caret, or takes its bookmark off; a block given its id now is saved
 * first, so the bookmark names a block the stored note holds. */
async function bookmarkLine(pos?: number): Promise<void> {
  const line = editor.value?.lineAt(pos) ?? null;

  if (line === null) return;

  if (line.wrote) {
    if (debounce !== null) {
      clearTimeout(debounce);
      debounce = null;
    }

    await flush();
  }

  emit("line", { block: line.block, quote: line.quote });
}

// Whether the line under the caret is bookmarked, read as the more menu opens.
const caretMarked = ref(false);

function readCaret(open: boolean): void {
  if (!open) return;

  const block = readonly.value ? null : (editor.value?.caretBlock() ?? null);

  caretMarked.value = block !== null && props.markedLines.includes(block);
}

/** Sends what the editor holds, naming the version it was made from (`docs/api.md`, 「Notes」). */
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
      doc: taken?.doc
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
      ...(readonly.value
        ? []
        : [
            {
              label: i18n.t(caretMarked.value ? "note.action.unbookmark_line" : "note.action.bookmark_line"),
              icon: caretMarked.value ? "i-material-symbols-bookmark" : "i-material-symbols-bookmark-outline",
              onSelect: () => void bookmarkLine()
            }
          ]),
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

const iconShown = computed(() => note.value?.icon ?? "");
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col" :style="props.wide ? { '--note-width': 'none' } : undefined" data-note-region>
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
          :label="props.bookmarked ? $t('note.action.unbookmark') : $t('note.action.bookmark')"
          :icon="props.bookmarked ? 'i-material-symbols-bookmark' : 'i-material-symbols-bookmark-outline'"
          :class="props.bookmarked ? 'text-primary' : ''"
          size="sm"
          :aria-pressed="props.bookmarked"
          data-note-bookmark
          @click="act(props.bookmarked ? 'unbookmark' : 'bookmark')"
        />
        <IconButton v-if="owns && !props.trashed" :label="$t('note.action.share')" icon="i-material-symbols-share-outline" size="sm" data-note-share @click="act('share')" />
        <UDropdownMenu :items="moreItems" :content="{ align: 'end' }" @update:open="readCaret">
          <IconButton :label="$t('note.action.more')" icon="i-material-symbols-more-vert" size="sm" data-note-more />
        </UDropdownMenu>
      </div>
    </div>

    <template v-if="stand === 'loading'">
      <NoteToolbar :editor="null" />
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
          :comments="!readonly"
          :href="linkHref"
          :find-notes="findNotes"
          :open-threads="comments.openIds.value"
          :chosen-thread="chosenThread"
          :gap="gap"
          :agent="readonly ? undefined : askAgent"
          :marked="props.markedLines"
          @change="onEdit"
          @title="liveTitle = $event"
          @ready="ready"
          @link="openLink"
          @thread="openThread"
          @comment="draftComment"
          @bookmark="(pos) => void bookmarkLine(pos)"
        >
          <template #barEnd>
            <NoteCommentList :comments="comments" @open="openThread" />
            <HintTip v-if="!readonly" :text="$t('note.action.talk')" press>
              <UButton size="sm" color="neutral" :variant="talkOpen ? 'subtle' : 'ghost'" icon="i-material-symbols-forum-outline" :label="$t('note.action.talk')" data-talk-key @click="talkOpen = !talkOpen" />
            </HintTip>
          </template>
          <template #head>
            <NoteHead :icon="iconShown" :writable="!readonly" :busy="iconBusy" @pick="pickIcon" />
          </template>
          <template #gap>
            <NoteCommentGap
              :key="chosenThread ?? 'draft'"
              :comments="comments"
              :thread="chosenThread"
              :writable="!readonly"
              :owns="owns"
              :name-of="props.nameOf"
              @started="openThread"
              @close="closeGap"
            />
          </template>
          <template #foot>
            <NoteBacklinks :notes="backlinks" :href-of="props.hrefOf" @open="openBacklink" />
          </template>
        </NoteEditor>
      </div>

      <NoteTalk v-if="!readonly" v-model:open="talkOpen" :agent="askAgent" :lines="talkLines" :apply="talkApply" :replace="talkReplace" :rename="talkRename" />
    </div>
  </div>
</template>
