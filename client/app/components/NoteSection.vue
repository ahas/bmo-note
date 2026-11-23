<script setup lang="ts">
// One section of the navigator (`docs/design.md`, 「The console surface」): its name, which folds and
// unfolds it, a sort dropdown at its head's trailing end where the section sorts, and its rows. Its first
// read reserves the rows with a skeleton of the row's shape; an empty section is one line, a failed read
// one line with the key that tries again; the next page is read as the section's end comes into sight,
// the incoming rows reserved by a skeleton at its end. What stands before its notes — the folders of the own
// section, the bookmarks — is the section's lead; its head may take a row dragged onto it, and a right press or
// a held finger on its empty room offers what acts on the section itself.

import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import ChoiceSelect from "bmo-ui/app/components/ChoiceSelect.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";

import NoteRow from "./NoteRow.vue";
import { draggedRow, endDrag } from "../domain/drag";
import { SORTS } from "../domain/navigator";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { HeldRow } from "../domain/drag";
import type { NoteMeta, NotesSort } from "../../shared/types";
import type { SectionStand } from "../composables/useNavigator";

const props = defineProps<{
  name: string;
  rows: NoteMeta[];
  stand: SectionStand;
  folded: boolean;
  /** The line an empty section says. */
  empty: string;
  /** The order the section stands in, where it sorts. */
  sort?: NotesSort;
  more?: boolean;
  appending?: boolean;
  chosen: string | null;
  itemsOf: (note: NoteMeta) => DropdownMenuItem[][];
  hrefOf: (note: NoteMeta) => string;
  /** Whether the lead holds rows, so the section is not empty with no notes of its own. */
  filled?: boolean;
  /** What acts on the section itself, offered on its empty room. */
  roomItems?: DropdownMenuItem[][];
  /** Whether a row held over the head may land at the section's top. */
  takes?: (row: HeldRow) => boolean;
}>();

const emit = defineEmits<{
  fold: [folded: boolean];
  sort: [sort: NotesSort];
  open: [note: NoteMeta, event: MouseEvent];
  more: [];
  retry: [];
  drop: [row: HeldRow];
}>();

// A row held over the head, where it may land there.
const over = ref(false);

function overHead(event: DragEvent): void {
  const row = draggedRow(event);

  if (row === null || props.takes === undefined || !props.takes(row)) return;

  event.preventDefault();

  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";

  over.value = true;
}

function droppedOnHead(event: DragEvent): void {
  const row = draggedRow(event);

  over.value = false;

  if (row === null || props.takes === undefined || !props.takes(row)) return;

  event.preventDefault();
  endDrag();
  emit("drop", row);
}

const i18n = useI18n();

// A few rows stand for a section's first read; the real section is often shorter.
const RESERVED_ROWS = 3;

const sortChoices = computed(() => SORTS.map((sort) => ({ label: i18n.t(`note.sort.${sort}`), value: sort })));

// The section's end: in sight, it asks for the next page.
const end = useTemplateRef<HTMLElement>("end");
let watching: IntersectionObserver | null = null;

watch(
  end,
  (element) => {
    watching?.disconnect();
    watching = null;

    if (element === null) return;

    watching = new IntersectionObserver((seen) => {
      if (seen.some((one) => one.isIntersecting)) emit("more");
    });
    watching.observe(element);
  },
  { flush: "post" }
);

onBeforeUnmount(() => watching?.disconnect());
</script>

<template>
  <section class="flex flex-col" :aria-label="props.name">
    <!-- The head stands outside the folding part: its name folds the section, its sort key sorts it. -->
    <div
      class="mx-2 flex h-8 items-center gap-1 rounded-md pe-1 transition-colors"
      :class="over ? 'bg-accented ring-1 ring-inset ring-primary' : ''"
      data-section-head
      @dragover="overHead"
      @dragleave="over = false"
      @drop="droppedOnHead"
    >
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        :trailing-icon="props.folded ? 'i-material-symbols-chevron-right' : 'i-material-symbols-expand-more'"
        :label="props.name"
        class="min-w-0 text-sm font-medium text-muted"
        :aria-expanded="!props.folded"
        @click="emit('fold', !props.folded)"
      />
      <span class="ms-auto flex items-center gap-1">
        <slot name="head" />
      </span>
      <span v-if="props.sort !== undefined" class="flex">
        <!-- The sort is a value chosen from a list, so it is the layer's one select, its control the
             section head's extra-small icon key named by its tooltip. -->
        <UTooltip :text="$t('note.action.sort')">
          <ChoiceSelect
            :model-value="props.sort"
            :items="sortChoices"
            value-key="value"
            variant="ghost"
            size="xs"
            :trailing="false"
            :ui="{ base: 'p-1' }"
            :aria-label="$t('note.action.sort')"
            @update:model-value="(sort: NotesSort) => emit('sort', sort)"
          >
            <template #default>
              <UIcon name="i-material-symbols-sort" class="size-4 shrink-0" />
            </template>
          </ChoiceSelect>
        </UTooltip>
      </span>
    </div>

    <UCollapsible :open="!props.folded" :unmount-on-hide="false">
      <template #content>
        <UContextMenu :items="props.roomItems ?? []" :disabled="props.roomItems === undefined" :modal="false">
          <div class="flex flex-col" data-section-room>
            <slot name="lead" />
            <div v-if="props.stand === 'loading' && props.rows.length === 0" role="status" :aria-label="$t('note.status.loading')" class="flex flex-col px-2" data-skeleton>
              <div v-for="row in RESERVED_ROWS" :key="row" class="flex h-8 items-center gap-2 px-2">
                <USkeleton class="size-4.5 shrink-0 rounded-sm" />
                <USkeleton class="h-3.5 w-3/5 rounded-sm" />
              </div>
            </div>

            <p v-else-if="props.stand === 'failed' && props.rows.length === 0" role="alert" class="flex h-8 items-center gap-2 ps-4 pe-3 text-sm text-error">
              <span class="min-w-0 flex-1 truncate">{{ $t("note.error.section_failed") }}</span>
              <IconButton :label="$t('note.action.retry')" icon="i-material-symbols-refresh" size="xs" @click="emit('retry')" />
            </p>

            <p v-else-if="props.rows.length === 0 && !props.filled" class="flex h-8 items-center ps-4 pe-3 text-sm text-dimmed" data-empty>
              <span class="truncate">{{ props.empty }}</span>
            </p>

            <ul v-else class="flex flex-col">
              <li v-for="note in props.rows" :key="`${note.owner}/${note.id}`">
                <NoteRow :note="note" :chosen="props.chosen === `${note.owner}/${note.id}`" :items="props.itemsOf(note)" :href="props.hrefOf(note)" @open="emit('open', note, $event)" />
              </li>
              <li v-if="props.more" ref="end" aria-hidden="true">
                <div v-if="props.appending" class="flex h-8 items-center gap-2 px-4">
                  <USkeleton class="size-4.5 shrink-0 rounded-sm" />
                  <USkeleton class="h-3.5 w-2/5 rounded-sm" />
                </div>
                <div v-else class="h-8" />
              </li>
            </ul>
          </div>
        </UContextMenu>
      </template>
    </UCollapsible>
  </section>
</template>
