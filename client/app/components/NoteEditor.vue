<script setup lang="ts">
// The BlockSuite editor as this unit mounts it: the fork's page editor, one document, page mode, with
// the bundle's format bar standing over it. The element is the preset's own container, registered once
// (docs/affine.md, 「What stands borrowed」); its standard scope reaches the bar once the container has
// drawn, and reaches this file's caller for the foot line's count.

import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";
import { useToast } from "@nuxt/ui/composables/useToast";

import QuestionDialog from "bmo-ui/app/components/QuestionDialog.vue";

import "@toeverything/theme/style.css";

import NoteToolbar from "./NoteToolbar.vue";
import { ensureEditorRegistered, fromBase64, openNoteDoc, toBase64 } from "../domain/doc";
import { pageExtensions } from "../domain/editor";
import { countHolding } from "../domain/count";
import { followScreenMode } from "../domain/theme";

import type { EditorNotice } from "../domain/editor";
import type { Holding } from "../domain/count";
import type { NoteDoc } from "../domain/doc";
import type { BlockStdScope } from "@blocksuite/affine/std";

const props = defineProps<{ noteId: string; doc: string }>();

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
    (await overlay.create(QuestionDialog, { props: { title, confirm: i18n.t("note.action.apply"), leaving: true }, destroyOnClose: true }).open()) === true
};

onMounted(async () => {
  await ensureEditorRegistered();

  held = openNoteDoc(props.noteId, fromBase64(props.doc));

  stopChange = held.onChange(() => {
    emit("change");
    emit("title", held?.title() ?? "");
  });

  const container = document.createElement("affine-editor-container") as HTMLElement & {
    autofocus: boolean;
    doc: unknown;
    pageSpecs: unknown;
    std?: BlockStdScope;
    updateComplete?: Promise<boolean>;
  };

  container.autofocus = true;
  container.doc = held.store;
  container.pageSpecs = pageExtensions(notice);
  host.value?.append(container);

  // The bar drives the editor through its standard scope, which stands once the container has drawn.
  await container.updateComplete;
  scope.value = container.std ?? null;
  emit("ready");
});

onBeforeUnmount(() => {
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
  holding: (): Holding => (held === null ? { words: 0 } : countHolding(held.store))
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <NoteToolbar :std="scope" @failed="toast.add({ title: $t('note.error.image_failed'), color: 'error' })" />
    <div ref="host" class="note-editor-host min-h-0 flex-1 overflow-y-auto" />
  </div>
</template>

<style scoped>
/* The preset draws its own viewport; the host gives it the page's height and the one scroll. */
.note-editor-host {
  background: var(--affine-background-primary-color, var(--ui-bg));
}
</style>
