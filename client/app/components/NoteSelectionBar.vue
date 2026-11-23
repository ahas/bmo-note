<script setup lang="ts">
// The selection toolbar (`docs/design.md`, 「The console surface」): it floats over words chosen, holding Ask AI,
// the comment key, the link key and the inline marks, each a small key named in its tooltip. The link key
// opens a field for the address under the bar; Enter lays the link on the words and an empty field takes it
// off. The bar stands whole inside the screen, wrapping its keys into a second row where the screen is
// narrower than one, and stands only over words a reader may write.

import { nextTick, ref, shallowRef } from "vue";
import { BubbleMenu } from "@tiptap/vue-3/menus";
import HintTip from "bmo-ui/app/components/HintTip.vue";

import { activeMarks, MARKS } from "../domain/format";

import type { Editor } from "@tiptap/core";
import type { MarkId } from "../domain/format";

const props = defineProps<{
  editor: Editor;
  /** Whether a comment may be laid: the reader writes the note. */
  comment: boolean;
  /** Whether the bar stands down: while Ask AI's menu stands under the words. */
  hidden?: boolean;
}>();

const emit = defineEmits<{ ask: []; comment: [] }>();

const marks = ref<boolean[]>(MARKS.map(() => false));
const linking = ref(false);
const address = ref("");
const field = shallowRef<{ inputRef?: HTMLInputElement } | null>(null);

/** The bar stands over words chosen in the note's body, never in the title and never over an image chosen. */
function shouldShow({ editor, from, to }: { editor: Editor; from: number; to: number }): boolean {
  if (props.hidden === true || !editor.isEditable || from === to) return false;

  const { $from } = editor.state.selection;

  if ($from.parent.type.name === "title") return false;
  if (editor.isActive("image")) return false;

  marks.value = activeMarks(editor);

  return true;
}

function toggle(mark: MarkId): void {
  props.editor.chain().focus().toggleMark(mark).run();
  marks.value = activeMarks(props.editor);
}

async function openLink(): Promise<void> {
  address.value = String(props.editor.getAttributes("link").href ?? "");
  linking.value = true;
  await nextTick();
  field.value?.inputRef?.focus();
}

/** Lays the address on the words chosen, or takes the link off where the field stands empty. */
function setLink(): void {
  const href = address.value.trim();
  const chain = props.editor.chain().focus().extendMarkRange("link");

  if (href === "") chain.unsetLink().run();
  else chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/iu.test(href) ? href : `https://${href}` }).run();

  linking.value = false;
}

function closeLink(): void {
  linking.value = false;
  props.editor.commands.focus();
}

defineExpose({ openLink });
</script>

<template>
  <BubbleMenu
    :editor="props.editor"
    :should-show="shouldShow"
    :options="{ placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }"
    plugin-key="noteSelectionBar"
    class="z-20"
  >
    <div
      role="toolbar"
      :aria-label="$t('note.label.selection_bar')"
      class="flex max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-1 rounded-md border border-default bg-default p-1 shadow-lg"
      data-selection-bar
      @mousedown.prevent
    >
      <HintTip :text="$t('note.ask.key')" press>
        <UButton size="sm" color="primary" variant="ghost" icon="i-material-symbols-auto-awesome-outline" :label="$t('note.ask.key')" data-selection="ask" @click="emit('ask')" />
      </HintTip>
      <HintTip v-if="props.comment" :text="$t('note.comment.add')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-add-comment-outline" :aria-label="$t('note.comment.add')" data-selection="comment" @click="emit('comment')" />
      </HintTip>
      <HintTip :text="$t('note.action.link')" press>
        <UButton
          size="sm"
          color="neutral"
          :variant="props.editor.isActive('link') ? 'subtle' : 'ghost'"
          square
          icon="i-material-symbols-link"
          :aria-label="$t('note.action.link')"
          data-selection="link"
          @click="openLink"
        />
      </HintTip>
      <div class="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden="true" />
      <HintTip v-for="(mark, at) in MARKS" :key="mark.id" :text="$t(`note.mark.${mark.id}`)" press>
        <UButton
          size="sm"
          color="neutral"
          :variant="marks[at] ? 'subtle' : 'ghost'"
          square
          :icon="mark.icon"
          :aria-label="$t(`note.mark.${mark.id}`)"
          :aria-pressed="marks[at]"
          :data-selection="mark.id"
          @click="toggle(mark.id)"
        />
      </HintTip>
    </div>

    <form
      v-if="linking"
      class="mt-1 flex w-[min(20rem,calc(100vw-2rem))] items-center gap-1 rounded-md border border-default bg-default p-1 shadow-lg"
      data-link-field
      @submit.prevent="setLink"
    >
      <UInput
        ref="field"
        v-model="address"
        size="sm"
        variant="none"
        class="min-w-0 flex-1"
        :placeholder="$t('note.link.placeholder')"
        :aria-label="$t('note.action.link')"
        @keydown.escape.prevent="closeLink"
      />
      <UButton type="submit" size="sm" color="neutral" variant="subtle" :label="$t('note.action.apply')" />
    </form>
  </BubbleMenu>
</template>
