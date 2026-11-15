<script setup lang="ts">
// The navigator of the notes screen (`docs/design.md`, 「The console surface」): its head — the search
// entry with its key, the layer's create button and, beside the note on a wide screen, the fold key —
// then one scrolling list of its sections, the favourites standing only while something is pinned, and
// the trash at its foot. Choosing a note, the actions of a row and the sections' own reads are the
// screen's; the navigator draws them.

import { computed } from "vue";
import CreateButton from "bmo-ui/app/components/CreateButton.vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";

import NoteSection from "./NoteSection.vue";
import NoteTrash from "./NoteTrash.vue";
import { SCREEN_KBDS } from "../domain/keys";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { NavigatorBoard } from "../composables/useNavigator";
import type { NoteMeta } from "../../shared/types";

const props = defineProps<{
  board: NavigatorBoard;
  /** The open note's `owner/id`, or null with none open. */
  chosen: string | null;
  /** Inside the phone's drawer: the create button is the head's own add, and there is nothing to fold. */
  drawn: boolean;
  itemsOf: (note: NoteMeta) => DropdownMenuItem[][];
  hrefOf: (note: NoteMeta) => string;
}>();

const emit = defineEmits<{ open: [note: NoteMeta, event: MouseEvent]; create: []; search: []; fold: [] }>();

const board = computed(() => props.board);

const searchKbds = SCREEN_KBDS.search;
</script>

<template>
  <nav class="flex h-full min-h-0 w-full flex-col bg-default" :aria-label="$t('note.label.list')" data-navigator>
    <!-- The head: as tall as the note region's bar, its bottom line one with the bar's. The search entry's
         mark stands on the rows' marks: the head's inset and the entry's own room together are the rows'. -->
    <div class="flex h-12 shrink-0 items-center gap-1 border-b border-default ps-2 pe-2" data-navigator-head>
      <HintTip :text="$t('note.action.search')" :kbds="searchKbds" press class="flex min-w-0 flex-1">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-material-symbols-search"
          class="min-w-0 flex-1 px-2 text-muted"
          :aria-label="$t('note.action.search')"
          aria-keyshortcuts="Control+K Meta+K"
          data-search-entry
          @click="emit('search')"
        >
          <span class="min-w-0 flex-1 truncate text-start">{{ $t("note.action.search") }}</span>
          <span class="flex shrink-0 items-center gap-0.5 pointer-coarse:hidden" aria-hidden="true">
            <UKbd v-for="kbd in searchKbds" :key="kbd" :value="kbd" size="sm" />
          </span>
        </UButton>
      </HintTip>
      <CreateButton :label="$t('note.action.new')" :contained="props.drawn" :loading="board.creating.value" @click="emit('create')" />
      <IconButton v-if="!props.drawn" :label="$t('note.action.list_close')" :kbds="['meta', '\\']" icon="i-material-symbols-left-panel-close-outline" size="sm" @click="emit('fold')" />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-2" data-navigator-list>
      <div class="flex flex-col gap-2">
        <NoteSection
          v-if="board.pinned.value.length > 0"
          :name="$t('note.section.pinned')"
          :rows="board.pinned.value"
          :stand="board.pinnedStand.value"
          :folded="board.prefs.value.folded.pinned"
          :empty="$t('note.empty.pinned')"
          :chosen="props.chosen"
          :items-of="props.itemsOf"
          :href-of="props.hrefOf"
          @fold="board.setFolded('pinned', $event)"
          @open="(note, event) => emit('open', note, event)"
          @retry="board.load()"
        />
        <NoteSection
          :name="$t('note.section.mine')"
          :rows="board.sections.mine.rows"
          :stand="board.sections.mine.stand"
          :more="board.sections.mine.more"
          :appending="board.sections.mine.appending"
          :folded="board.prefs.value.folded.mine"
          :sort="board.prefs.value.sorts.mine"
          :empty="$t('note.empty.live')"
          :chosen="props.chosen"
          :items-of="props.itemsOf"
          :href-of="props.hrefOf"
          @fold="board.setFolded('mine', $event)"
          @sort="board.setSort('mine', $event)"
          @open="(note, event) => emit('open', note, event)"
          @more="board.append('mine')"
          @retry="board.loadSection('mine')"
        />
        <NoteSection
          :name="$t('note.section.shared')"
          :rows="board.sections.shared.rows"
          :stand="board.sections.shared.stand"
          :more="board.sections.shared.more"
          :appending="board.sections.shared.appending"
          :folded="board.prefs.value.folded.shared"
          :sort="board.prefs.value.sorts.shared"
          :empty="$t('note.empty.shared')"
          :chosen="props.chosen"
          :items-of="props.itemsOf"
          :href-of="props.hrefOf"
          @fold="board.setFolded('shared', $event)"
          @sort="board.setSort('shared', $event)"
          @open="(note, event) => emit('open', note, event)"
          @more="board.append('shared')"
          @retry="board.loadSection('shared')"
        />
      </div>
    </div>

    <div class="shrink-0 border-t border-default p-2" data-navigator-foot>
      <NoteTrash :trash="board.trash" :href-of="props.hrefOf" @read="board.loadSection('trash')" @open="(note, event) => emit('open', note, event)" />
    </div>
  </nav>
</template>
