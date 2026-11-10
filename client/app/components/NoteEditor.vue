<script setup lang="ts">
// The BlockSuite editor as this unit mounts it: the fork's page editor, one document, page mode. The
// element is the preset's own container, registered once (docs/affine.md, 「What stands borrowed」).

import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { useOverlay } from "@nuxt/ui/composables/useOverlay";

import QuestionDialog from "bmo-ui/app/components/QuestionDialog.vue";

import "@toeverything/theme/style.css";

import { ensureEditorRegistered, fromBase64, openNoteDoc, toBase64 } from "../domain/doc";
import { pageExtensions } from "../domain/editor";
import { followScreenMode } from "../domain/theme";

import type { EditorNotice } from "../domain/editor";
import type { NoteDoc } from "../domain/doc";

const props = defineProps<{ noteId: string; doc: string }>();

const emit = defineEmits<{ change: []; title: [title: string] }>();

const host = shallowRef<HTMLElement | null>(null);
const i18n = useI18n();
const overlay = useOverlay();

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
  };

  container.autofocus = true;
  container.doc = held.store;
  container.pageSpecs = pageExtensions(notice);
  host.value?.append(container);
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
  })
});
</script>

<template>
  <div ref="host" class="note-editor-host min-h-0 flex-1 overflow-y-auto" />
</template>

<style scoped>
/* The preset draws its own viewport; the host gives it the page's height and the one scroll. */
.note-editor-host {
  background: var(--affine-background-primary-color, var(--ui-bg));
}
</style>
