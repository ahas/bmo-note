<script setup lang="ts">
// The backlinks under the open note's document (`docs/design.md`, 「Note links」): the live notes the reader
// reads that link to this one, each its icon and title, pressed to open it as a navigator row is. A note
// nobody links to lists nothing and its head does not stand.

import { useI18n } from "vue-i18n";

import { NOTE_MARK } from "../domain/icons";

import type { NoteMeta } from "../../shared/types";

const props = defineProps<{
  notes: readonly NoteMeta[];
  /** Where a row leads, as an address the browser can open in a new tab. */
  hrefOf: (note: NoteMeta) => string;
}>();

const emit = defineEmits<{ open: [note: NoteMeta, newTab: boolean] }>();

const i18n = useI18n();

function titleOf(note: NoteMeta): string {
  return note.title.trim() === "" ? i18n.t("note.label.untitled") : note.title;
}

function pressed(event: MouseEvent, note: NoteMeta): void {
  if (event.shiftKey || event.button !== 0) return;

  event.preventDefault();
  emit("open", note, event.ctrlKey || event.metaKey);
}
</script>

<template>
  <section v-if="props.notes.length > 0" class="mt-4 border-t border-default pt-4 sm:mx-8" :aria-label="$t('note.link.backlinks')" data-backlinks>
    <h2 class="mb-2 text-sm font-medium text-muted">{{ $t("note.link.backlinks") }}</h2>
    <ul class="flex flex-col">
      <li v-for="note in props.notes" :key="`${note.owner}/${note.id}`">
        <a
          :href="props.hrefOf(note)"
          class="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm text-default transition-colors hover:bg-elevated active:bg-accented focus-visible:outline-2 focus-visible:outline-primary"
          draggable="false"
          data-backlink
          @click="pressed($event, note)"
        >
          <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
            <span v-if="note.icon !== ''" class="text-base leading-none">{{ note.icon }}</span>
            <UIcon v-else :name="NOTE_MARK" class="size-4.5 text-dimmed" />
          </span>
          <span class="min-w-0 flex-1 truncate" :class="note.title.trim() === '' ? 'text-dimmed' : ''">{{ titleOf(note) }}</span>
        </a>
      </li>
    </ul>
  </section>
</template>
