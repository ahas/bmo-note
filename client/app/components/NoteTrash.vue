<script setup lang="ts">
// The trash at the navigator's foot (`docs/design.md`, 「The console surface」): a key opening a popover of
// the reader's trashed notes, newest trashed first, read when it opens, with a field that filters them
// through the layer's list search. A row opens its note in the note region, read only under its band.

import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import SearchText from "bmo-ui/app/components/SearchText.vue";
import { countLocale } from "bmo-ui/app/domain/numbers";
import { filterRecords } from "bmo-ui/shared/search";

import { NOTE_MARK } from "../domain/icons";

import type { NoteMeta } from "../../shared/types";
import type { SectionRows } from "../composables/useNavigator";

const props = defineProps<{ trash: SectionRows; hrefOf: (note: NoteMeta) => string }>();

const emit = defineEmits<{ read: []; open: [note: NoteMeta, event: MouseEvent] }>();

const i18n = useI18n();
const open = ref(false);
const words = ref("");

watch(open, (standing) => {
  if (standing) {
    words.value = "";
    emit("read");
  }
});

function titleOf(note: NoteMeta): string {
  return note.title === "" ? i18n.t("note.label.untitled") : note.title;
}

function trashedOf(note: NoteMeta): string {
  return new Intl.DateTimeFormat(i18n.locale.value, { month: "short", day: "numeric" }).format(note.deletedAt ?? note.changedAt);
}

const shown = computed(() =>
  filterRecords(props.trash.rows, (note) => [{ label: "", text: titleOf(note), shown: true }, { label: "", text: trashedOf(note), shown: true }], words.value, countLocale())
);

function pressed(note: NoteMeta, event: MouseEvent): void {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;

  event.preventDefault();
  open.value = false;
  emit("open", note, event);
}
</script>

<template>
  <UPopover v-model:open="open" :content="{ side: 'top', align: 'start' }">
    <UButton color="neutral" variant="ghost" size="sm" icon="i-material-symbols-delete-outline" :label="$t('note.section.trash')" class="w-full text-muted" />

    <template #content>
      <div class="flex max-h-[min(28rem,70dvh)] w-80 max-w-[calc(100vw-2rem)] flex-col">
        <div class="shrink-0 border-b border-default p-2">
          <UInput v-model="words" icon="i-material-symbols-search" size="sm" :placeholder="$t('note.search.placeholder')" class="w-full" variant="none" />
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          <div v-if="props.trash.stand === 'loading' && props.trash.rows.length === 0" role="status" :aria-label="$t('note.status.loading')" class="flex flex-col px-2">
            <div v-for="row in 3" :key="row" class="flex h-8 items-center gap-2 px-2">
              <USkeleton class="size-4.5 shrink-0 rounded-sm" />
              <USkeleton class="h-3.5 w-3/5 rounded-sm" />
            </div>
          </div>
          <p v-else-if="props.trash.stand === 'failed' && props.trash.rows.length === 0" role="alert" class="px-4 py-2 text-sm text-error">{{ $t("note.error.section_failed") }}</p>
          <p v-else-if="props.trash.rows.length === 0" class="px-4 py-2 text-sm text-dimmed">{{ $t("note.empty.trash") }}</p>
          <p v-else-if="shown.length === 0" class="px-4 py-2 text-sm text-dimmed">{{ $t("note.search.none") }}</p>
          <ul v-else class="flex flex-col">
            <li v-for="note in shown" :key="note.id" class="px-2">
              <a :href="props.hrefOf(note)" class="focus-inset flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-sm transition-colors select-none hover:bg-elevated active:bg-accented" draggable="false" @click="pressed(note, $event)">
                <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                  <span v-if="note.icon !== ''" class="text-base leading-none">{{ note.icon }}</span>
                  <UIcon v-else :name="NOTE_MARK" class="size-4.5 text-dimmed" />
                </span>
                <HintTip :text="titleOf(note)" cut press class="block min-w-0 flex-1 truncate" :class="note.title === '' ? 'text-dimmed' : ''">
                  <SearchText :text="titleOf(note)" :query="words" />
                </HintTip>
                <SearchText :text="trashedOf(note)" :query="words" class="shrink-0 text-sm tabular-nums text-dimmed" />
              </a>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </UPopover>
</template>
