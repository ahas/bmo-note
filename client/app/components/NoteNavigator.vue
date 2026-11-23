<script setup lang="ts">
// The navigator of the notes screen (`docs/design.md`, 「The console surface」): its head — the search
// entry with its key, the layer's create button and, beside the note on a wide screen, the fold key —
// then one scrolling list of its sections, the bookmarks standing only while something is bookmarked, the
// reader's own notes as their folder tree and the notes shared with them, and the trash at its foot. Choosing a
// note, the actions of a row and a folder, a row dragged onto a folder and the sections' own reads are the
// screen's; the navigator draws them.

import { computed } from "vue";
import CreateButton from "bmo-ui/app/components/CreateButton.vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";

import NoteBookmarkRow from "./NoteBookmarkRow.vue";
import NoteFolderBranch from "./NoteFolderBranch.vue";
import NoteSection from "./NoteSection.vue";
import NoteTrash from "./NoteTrash.vue";
import { SCREEN_KBDS } from "../domain/keys";
import { holdsFolder, noteKeyOf } from "../domain/navigator";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { NavigatorBoard } from "../composables/useNavigator";
import type { HeldRow } from "../domain/drag";
import type { NoteBookmark, NoteFolder, NoteMeta } from "../../shared/types";

/** What the screen does for the navigator's folders and bookmarks. */
export interface NavigatorActs {
  folderItemsOf: (folder: NoteFolder) => DropdownMenuItem[][];
  bookmarkItemsOf: (bookmark: NoteBookmark) => DropdownMenuItem[][];
  /** Where a note's or a line's bookmark leads; null for a folder's. */
  bookmarkHref: (bookmark: NoteBookmark) => string | null;
  openBookmark: (bookmark: NoteBookmark, event: MouseEvent) => void;
  /** A folder's name kept, or null where it keeps the one it had. */
  nameFolder: (folder: NoteFolder, name: string | null) => void;
  /** A row dragged onto a folder, or onto the own section's head for the top. */
  dropRow: (folder: string | null, row: HeldRow) => void;
  folderKey: (folder: NoteFolder, key: "rename" | "delete") => void;
  newFolder: () => void;
  /** What acts on the own section itself, on its empty room. */
  roomItems: DropdownMenuItem[][];
}

const props = defineProps<{
  board: NavigatorBoard;
  /** The open note's `owner/id`, or null with none open. */
  chosen: string | null;
  /** Inside the phone's drawer: the create button is the head's own add, and there is nothing to fold. */
  drawn: boolean;
  itemsOf: (note: NoteMeta) => DropdownMenuItem[][];
  hrefOf: (note: NoteMeta) => string;
  acts: NavigatorActs;
}>();

const emit = defineEmits<{ open: [note: NoteMeta, event: MouseEvent]; create: []; search: []; fold: [] }>();

const board = computed(() => props.board);

const searchKbds = SCREEN_KBDS.search;

// A row lands in a folder unless it is that folder or a folder holding it; anything lands at the top.
function takes(row: HeldRow, folder: string): boolean {
  return row.kind === "note" || !holdsFolder(props.board.folders.value, row.id, folder);
}

const takesTop = (): boolean => true;

function bookmarkChosen(bookmark: NoteBookmark): boolean {
  return bookmark.kind === "note" && bookmark.note !== null && props.chosen === noteKeyOf(bookmark.note);
}
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
          v-if="board.bookmarks.value.length > 0"
          :name="$t('note.section.bookmarks')"
          :rows="[]"
          :stand="board.bookmarksStand.value"
          :folded="board.prefs.value.folded.bookmarks"
          empty=""
          filled
          :chosen="props.chosen"
          :items-of="props.itemsOf"
          :href-of="props.hrefOf"
          data-bookmarks
          @fold="board.setFolded('bookmarks', $event)"
          @retry="board.loadBookmarks()"
        >
          <template #lead>
            <ul class="flex flex-col">
              <li v-for="bookmark in board.bookmarks.value" :key="bookmark.id">
                <NoteBookmarkRow
                  :bookmark="bookmark"
                  :items="props.acts.bookmarkItemsOf(bookmark)"
                  :href="props.acts.bookmarkHref(bookmark)"
                  :chosen="bookmarkChosen(bookmark)"
                  @open="props.acts.openBookmark(bookmark, $event)"
                />
              </li>
            </ul>
          </template>
        </NoteSection>
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
          :filled="board.folders.value.length > 0"
          :room-items="props.acts.roomItems"
          :takes="takesTop"
          data-mine
          @fold="board.setFolded('mine', $event)"
          @sort="board.setSort('mine', $event)"
          @open="(note, event) => emit('open', note, event)"
          @more="board.append('mine')"
          @retry="board.loadSection('mine')"
          @drop="props.acts.dropRow(null, $event)"
        >
          <template #head>
            <IconButton :label="$t('note.action.new_folder')" icon="i-material-symbols-create-new-folder-outline" size="xs" data-new-folder @click="props.acts.newFolder()" />
          </template>
          <template #lead>
            <ul v-if="board.tree.value.length > 0" class="flex flex-col" data-folders>
              <NoteFolderBranch
                v-for="node in board.tree.value"
                :key="node.folder.id"
                :node="node"
                :board="board"
                :chosen="props.chosen"
                :items-of="props.itemsOf"
                :href-of="props.hrefOf"
                :folder-items-of="props.acts.folderItemsOf"
                :takes="takes"
                :on-name="props.acts.nameFolder"
                :on-drop="props.acts.dropRow"
                :on-key="props.acts.folderKey"
                @open="(note, event) => emit('open', note, event)"
              />
            </ul>
          </template>
        </NoteSection>
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
