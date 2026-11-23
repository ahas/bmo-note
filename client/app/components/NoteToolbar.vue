<script setup lang="ts">
// The format bar over the editor (`docs/design.md`, 「The console surface」): the Agent leading it, the kind the
// block under the caret takes, the inline marks, the image upload and the table insert, in one gathered row,
// and what acts on the whole note at its trailing edge. Every key is the library's small button, an icon-only
// one its small square. It holds no formatting of its own: each press rides the editor's own commands through
// `domain/format`, the mechanism the keys and the slash menu ride. While the editor is still mounting, or over
// a note held to read only, the keys stand disabled.

import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ChoiceSelect from "bmo-ui/app/components/ChoiceSelect.vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import ToolBar from "bmo-ui/app/components/ToolBar.vue";

import { activeKind, activeMarks, BAR_KINDS, insertInto, MARKS, turnInto } from "../domain/format";

import type { Editor } from "@tiptap/core";
import type { KindId, MarkId } from "../domain/format";

const props = withDefaults(
  defineProps<{
    editor: Editor | null;
    /** Whether the Agent key stands: not over a note the reader holds to read only. */
    agent?: boolean;
    /** Whether an image is being stored. */
    working?: boolean;
  }>(),
  { agent: true, working: false }
);

const emit = defineEmits<{ agent: []; image: [files: File[]] }>();

const i18n = useI18n();

const kind = ref<KindId | null>(null);
const marks = ref<boolean[]>(MARKS.map(() => false));
const writable = ref(false);
const picked = shallowRef<HTMLInputElement | null>(null);

const kindChoices = computed(() => BAR_KINDS.map((item) => ({ label: i18n.t(`note.kind.${item.id}`), icon: item.icon, value: item.id })));
const kindIcon = computed(() => BAR_KINDS.find((item) => item.id === kind.value)?.icon ?? "i-material-symbols-text-fields");

function refresh(): void {
  const editor = props.editor;

  writable.value = editor !== null && editor.isEditable;
  kind.value = editor === null ? null : activeKind(editor);
  marks.value = editor === null ? MARKS.map(() => false) : activeMarks(editor);
}

// The editor arrives once it has drawn, after this row stands; the row follows its every transaction.
watch(
  () => props.editor,
  (editor, before) => {
    before?.off("transaction", refresh);
    editor?.on("transaction", refresh);
    refresh();
  },
  { immediate: true }
);

onBeforeUnmount(() => props.editor?.off("transaction", refresh));

function toggle(mark: MarkId): void {
  props.editor?.chain().focus().toggleMark(mark).run();
}

function turn(id: KindId): void {
  const editor = props.editor;

  if (editor === null) return;

  turnInto(editor.chain().focus(), id).run();
}

function addTable(): void {
  const editor = props.editor;

  if (editor !== null) insertInto(editor.chain().focus(), "table").run();
}

function pickImage(): void {
  picked.value?.click();
}

function standChosen(): void {
  const input = picked.value;
  const files = [...(input?.files ?? [])];

  if (input !== null) input.value = "";
  if (files.length > 0) emit("image", files);
}

defineExpose({ pickImage });
</script>

<template>
  <!-- `@mousedown.prevent` keeps the caret and the selection in the document: the commands run against the
       editor's own selection, and a control that took focus would take the selection with it. The row stays
       one row at a phone's width and scrolls its keys sideways between its two ends. -->
  <ToolBar :label="$t('note.label.toolbar')" @mousedown.prevent>
    <div v-if="$slots.start" class="sticky start-0 z-10 flex shrink-0 items-center bg-default shadow-[inset_0_-1px_0_var(--ui-border)]">
      <slot name="start" />
    </div>

    <div class="mx-auto flex h-full w-max shrink-0 items-center gap-1" data-bar-row>
      <HintTip v-if="props.agent" :text="$t('note.agent.key')" press>
        <UButton
          size="sm"
          color="primary"
          variant="ghost"
          icon="i-material-symbols-auto-awesome-outline"
          :label="$t('note.agent.key')"
          :disabled="!writable"
          data-bar="agent"
          @click="emit('agent')"
        />
      </HintTip>

      <div v-if="props.agent" class="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <HintTip :text="$t('note.action.turn_into')" press>
        <!-- The kind the block under the caret takes is a value chosen from a list, so it is the layer's one
             select, its control the bar's small key showing the standing kind's icon. -->
        <ChoiceSelect
          :model-value="kind ?? undefined"
          :items="kindChoices"
          value-key="value"
          variant="ghost"
          size="sm"
          trailing-icon="i-material-symbols-expand-more"
          :ui="{ base: 'ps-2.5' }"
          :disabled="!writable"
          :aria-label="$t('note.action.turn_into')"
          data-bar="kind"
          @update:model-value="(id: KindId) => turn(id)"
        >
          <template #default>
            <UIcon :name="kindIcon" class="size-4 shrink-0" />
          </template>
        </ChoiceSelect>
      </HintTip>

      <div class="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <HintTip v-for="(mark, at) in MARKS" :key="mark.id" :text="$t(`note.mark.${mark.id}`)" press>
        <UButton
          size="sm"
          color="neutral"
          :variant="marks[at] ? 'subtle' : 'ghost'"
          square
          :icon="mark.icon"
          :disabled="!writable"
          :aria-label="$t(`note.mark.${mark.id}`)"
          :aria-pressed="marks[at]"
          :data-bar="mark.id"
          @click="toggle(mark.id)"
        />
      </HintTip>

      <div class="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <HintTip :text="$t('note.action.image')" press>
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          square
          icon="i-material-symbols-add-photo-alternate"
          :loading="props.working"
          :disabled="!writable || props.working"
          :aria-label="$t('note.action.image')"
          data-bar="image"
          @click="pickImage"
        />
      </HintTip>

      <HintTip :text="$t('note.action.table')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-grid-view" :disabled="!writable" :aria-label="$t('note.action.table')" data-bar="table" @click="addTable" />
      </HintTip>

      <!-- The input the image key opens, never drawn. -->
      <input ref="picked" type="file" accept="image/*" multiple hidden data-bar="file" @change="standChosen" />
    </div>

    <!-- What acts on the whole note rather than the selection stands apart at the bar's trailing edge. -->
    <div v-if="$slots.end" class="sticky end-0 z-10 flex shrink-0 items-center gap-1 bg-default shadow-[inset_0_-1px_0_var(--ui-border)]">
      <slot name="end" />
    </div>
  </ToolBar>
</template>
