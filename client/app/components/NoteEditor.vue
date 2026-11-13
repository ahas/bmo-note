<script setup lang="ts">
// The BlockSuite editor as this unit mounts it: the fork's page editor, one document, page mode, with
// the bundle's format bar standing over it. The element is the preset's own container, registered once
// (docs/affine.md, 「What stands borrowed」); its standard scope reaches the bar once the container has
// drawn, and reaches this file's caller for the foot line's count. A note opened read only — shared with
// the reader to read, or on its share page — stands with its edits refused, the bar's keys disabled and
// no Ask AI (`docs/design.md`, 「Sharing on the screens」).

import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";
import { useToast } from "@nuxt/ui/composables/useToast";

import QuestionDialog from "bmo-ui/app/components/QuestionDialog.vue";

import "@toeverything/theme/style.css";

import NoteAsk from "./NoteAsk.vue";
import NoteToolbar from "./NoteToolbar.vue";
import { applyOps, readRows, replaceBody, runOf } from "../domain/apply";
import { noteBlobSource } from "../domain/blobs";
import { ensureEditorRegistered, fromBase64, openNoteDoc, toBase64 } from "../domain/doc";
import { pageExtensions } from "../domain/editor";
import { countHolding } from "../domain/count";
import { passageElement, passageModels } from "../domain/format";
import { asOneStep, historyDirectionOf, stepHistory } from "../domain/history";
import { linesOf, opaqueRow } from "../domain/text";
import { followScreenMode } from "../domain/theme";
import { writeNoteTitle } from "../domain/title";

import type { BlobSource } from "../domain/blobs";
import type { EditorNotice } from "../domain/editor";
import type { Holding } from "../domain/count";
import type { NoteDoc } from "../domain/doc";
import type { ReplaceResult } from "../domain/apply";
import type { Op } from "../domain/patch";
import type { BlockStdScope } from "@blocksuite/affine/std";

const props = withDefaults(
  defineProps<{
    noteId: string;
    doc: string;
    title: string;
    /** Where the note's images are read and stored; the reader's own note's routes where none is given. */
    blobs?: BlobSource;
    readonly?: boolean;
    /** Whether the format bar stands over the document. */
    toolbar?: boolean;
  }>(),
  { blobs: undefined, readonly: false, toolbar: true }
);

const emit = defineEmits<{ change: []; title: [title: string]; ready: [] }>();

const host = shallowRef<HTMLElement | null>(null);
const scope = shallowRef<BlockStdScope | null>(null);
const i18n = useI18n();
const overlay = useOverlay();
const toast = useToast();

// The editor reads its colours off the document element, so the console's mode stands there before
// the container is mounted.
followScreenMode();

let held: NoteDoc | null = null;
let stopChange: (() => void) | null = null;

const notice: EditorNotice = {
  toast: () => {
    // The editor's own failure lines; the save state carries what must reach the reader's attention.
  },
  confirm: async (title: string) =>
    (await overlay.create(QuestionDialog, { props: { title, confirm: i18n.t("note.action.apply"), leaving: true }, destroyOnClose: true }).open()) === true,
  ask: props.readonly ? null : () => openAsk(),
  askLabel: i18n.t("note.ask.key")
};

// Ask AI (`docs/design.md`, 「Ask AI」): the passage is taken as the key is pressed — the blocks the
// selection covers, the one under the caret, or the whole note — and the result is placed over that run.
const asking = ref(false);
const passage = shallowRef<{ at: number; count: number; lines: string[]; opaque: boolean } | null>(null);
const anchor = shallowRef<{ getBoundingClientRect: () => DOMRect } | undefined>(undefined);

function openAsk(): void {
  const std = scope.value;

  if (std === null || held === null) return;

  // Where the editor holds neither a selection nor a caret, the passage is the whole note.
  const chosen = passageModels(std);
  const models = chosen.length > 0 ? chosen : readRows(held.store).map((row) => row.model);
  const run = runOf(held.store, models);

  if (run === null) return;

  const element = passageElement(std, models);

  passage.value = { at: run.at, count: run.count, lines: linesOf(run.rows), opaque: run.rows.some(opaqueRow) };
  anchor.value = element === null ? undefined : { getBoundingClientRect: () => element.getBoundingClientRect() };
  asking.value = true;
}

function placeAsked(how: "replace" | "below", lines: string[]): void {
  const taken = passage.value;

  if (held === null || taken === null) return;

  try {
    applyOps(held.store, [how === "replace" ? { at: taken.at, del: taken.count, insert: lines } : { at: taken.at + taken.count, del: 0, insert: lines }]);
  } catch {
    toast.add({ title: i18n.t("note.talk.apply_failed"), color: "error" });
  }
}

onMounted(async () => {
  await ensureEditorRegistered();

  held = openNoteDoc(props.noteId, fromBase64(props.doc), props.blobs ?? noteBlobSource(props.noteId), props.readonly);

  stopChange = held.onChange(() => {
    emit("change");
    emit("title", held?.title() ?? "");
  });

  addEventListener("keydown", answerHistoryKey, true);

  const container = document.createElement("affine-editor-container") as HTMLElement & {
    autofocus: boolean;
    doc: unknown;
    pageSpecs: unknown;
    std?: BlockStdScope;
    updateComplete?: Promise<boolean>;
  };

  container.autofocus = !props.readonly;
  container.doc = held.store;
  container.pageSpecs = pageExtensions(notice);
  host.value?.append(container);

  // The bar drives the editor through its standard scope, which stands once the container has drawn.
  await container.updateComplete;
  scope.value = container.std ?? null;
  emit("ready");
});

// The history keys, caught on the way down before the editor sees them: they answer wherever on the
// screen the focus stands, not only while the fork's own event flow is active. A plain text field —
// the talk's and the ask's own inputs — keeps the key for its own undo (`docs/design.md`, 「Editing
// and saving」).
function standsInTextField(target: EventTarget | null): boolean {
  const tag = (target as { tagName?: string } | null)?.tagName;

  return tag === "INPUT" || tag === "TEXTAREA";
}

function answerHistoryKey(event: KeyboardEvent): void {
  const direction = historyDirectionOf(event);

  if (direction === null || standsInTextField(event.target)) return;

  event.preventDefault();
  event.stopPropagation();

  const store = held?.store ?? null;

  if (store !== null) stepHistory(store, direction);
}

onBeforeUnmount(() => {
  removeEventListener("keydown", answerHistoryKey, true);
  stopChange?.();
  held?.dispose();
  held = null;
});

defineExpose({
  /** The document as the save writes it: the whole state, base64, and the title of its root. */
  snapshot: (): { doc: string; title: string } => ({
    doc: held === null ? "" : toBase64(held.serialize()),
    title: held?.title() ?? ""
  }),
  /** What the note holds now, for the foot line. */
  holding: (): Holding => (held === null ? { words: 0 } : countHolding(held.store)),
  /** The note's body as the talk asks over it: one line per block (`domain/text`). */
  lines: (): string[] => (held === null ? [] : linesOf(readRows(held.store))),
  /** Writes the talk's anchored patch into the open document; the editor's own change makes it save. */
  apply: (ops: Op[]): boolean => {
    if (held === null) return false;

    try {
      applyOps(held.store, ops);

      return true;
    } catch {
      return false;
    }
  },
  /** Writes the whole body from the answer, where the anchored patch could not land, keeping the
   * note's images and tables: the result names what stands in the way where nothing was written. */
  replace: (lines: string[]): ReplaceResult => {
    if (held === null) return { ok: false, kinds: [] };

    try {
      return replaceBody(held.store, lines);
    } catch {
      return { ok: false, kinds: [] };
    }
  },
  /** Writes the title the talk's answer renamed the note to into the document's own title field,
   * as one transaction: the rename stands and goes as one undo step. */
  rename: (title: string): boolean => {
    const note = held;

    if (note === null) return false;

    return asOneStep(note.store.spaceDoc, () => writeNoteTitle(note.store.root, title));
  }
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <NoteToolbar v-if="props.toolbar" :std="props.readonly ? null : scope" :ask="!props.readonly" @failed="toast.add({ title: $t('note.error.image_failed'), color: 'error' })" @ask="openAsk">
      <template v-if="$slots.barStart" #start>
        <slot name="barStart" />
      </template>
      <template v-if="$slots.barEnd" #end>
        <slot name="barEnd" />
      </template>
    </NoteToolbar>
    <div ref="host" data-note-editor class="note-editor-host min-h-0 flex-1 overflow-y-auto" />

    <NoteAsk
      v-if="!props.readonly"
      v-model:open="asking"
      :note-id="props.noteId"
      :title="props.title"
      :passage="passage?.lines ?? null"
      :opaque="passage?.opaque ?? false"
      :anchor="anchor"
      @place="placeAsked"
    />
  </div>
</template>

<style scoped>
/* The preset draws its own viewport; the host gives it the page's height and the one scroll. */
.note-editor-host {
  background: var(--affine-background-primary-color, var(--ui-bg));
}

/* On a touch screen the editor's floating format menu stands down: the bar does its work, and the phone lays its
   own selection menu over the words (`docs/design.md`, 「The console surface」). The editor lays its styles
   unlayered, so the rule holds by importance. */
@media (pointer: coarse) {
  .note-editor-host :deep(affine-toolbar-widget) {
    display: none !important;
  }
}
</style>
