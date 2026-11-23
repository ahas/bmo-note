<script setup lang="ts">
// One folder of the navigator's tree with what it holds (`docs/design.md`, 「The console surface」): its row, and,
// unfolded, one step further in, the folders standing in it and then its notes in the own section's order, read
// thirty at a time as the section's are, an empty folder one dimmed line saying so.

import { computed, onBeforeUnmount, useTemplateRef, watch } from "vue";

import NoteFolderRow from "./NoteFolderRow.vue";
import NoteRow from "./NoteRow.vue";
import { rowInset } from "../domain/navigator";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { NavigatorBoard } from "../composables/useNavigator";
import type { HeldRow } from "../domain/drag";
import type { FolderNode } from "../domain/navigator";
import type { NoteFolder, NoteMeta } from "../../shared/types";

defineOptions({ name: "NoteFolderBranch" });

const props = defineProps<{
  node: FolderNode;
  board: NavigatorBoard;
  chosen: string | null;
  itemsOf: (note: NoteMeta) => DropdownMenuItem[][];
  hrefOf: (note: NoteMeta) => string;
  folderItemsOf: (folder: NoteFolder) => DropdownMenuItem[][];
  /** Whether a held row may land in the folder. */
  takes: (row: HeldRow, folder: string) => boolean;
  onName: (folder: NoteFolder, name: string | null) => void;
  onDrop: (folder: string, row: HeldRow) => void;
  onKey: (folder: NoteFolder, key: "rename" | "delete") => void;
}>();

const emit = defineEmits<{ open: [note: NoteMeta, event: MouseEvent] }>();

const id = computed(() => props.node.folder.id);
const open = computed(() => props.board.prefs.value.open.includes(id.value));
const rows = computed(() => props.board.folderRows[id.value] ?? null);

// The folder's end: in sight, it asks for the next page of its notes.
const end = useTemplateRef<HTMLElement>("end");
let watching: IntersectionObserver | null = null;

watch(
  end,
  (element) => {
    watching?.disconnect();
    watching = null;

    if (element === null) return;

    watching = new IntersectionObserver((seen) => {
      if (seen.some((one) => one.isIntersecting)) void props.board.append(`folder:${id.value}`);
    });
    watching.observe(element);
  },
  { flush: "post" }
);

onBeforeUnmount(() => watching?.disconnect());

const inner = computed(() => props.node.depth + 1);
</script>

<template>
  <li>
    <NoteFolderRow
      :folder="props.node.folder"
      :depth="props.node.depth"
      :open="open"
      :naming="props.board.naming.value === id"
      :shown="props.board.shown.value === id"
      :items="props.folderItemsOf(props.node.folder)"
      :takes="(row) => props.takes(row, id)"
      @toggle="props.board.setOpen(id, !open)"
      @name="(name) => props.onName(props.node.folder, name)"
      @drop="(row) => props.onDrop(id, row)"
      @key="(key) => props.onKey(props.node.folder, key)"
    />
    <ul v-if="open" class="flex flex-col" :aria-label="props.node.folder.name">
      <NoteFolderBranch
        v-for="child in props.node.children"
        :key="child.folder.id"
        :node="child"
        :board="props.board"
        :chosen="props.chosen"
        :items-of="props.itemsOf"
        :href-of="props.hrefOf"
        :folder-items-of="props.folderItemsOf"
        :takes="props.takes"
        :on-name="props.onName"
        :on-drop="props.onDrop"
        :on-key="props.onKey"
        @open="(note, event) => emit('open', note, event)"
      />
      <template v-if="rows === null || (rows.stand === 'loading' && rows.rows.length === 0)">
        <li role="status" :aria-label="$t('note.status.loading')" class="px-2" data-skeleton>
          <div class="flex h-8 items-center gap-2 pe-2" :style="{ paddingInlineStart: rowInset(inner) }">
            <USkeleton class="size-4.5 shrink-0 rounded-sm" />
            <USkeleton class="h-3.5 w-3/5 rounded-sm" />
          </div>
        </li>
      </template>
      <li v-else-if="rows.stand === 'failed' && rows.rows.length === 0" role="alert" class="flex h-8 items-center pe-3 text-sm text-error" :style="{ paddingInlineStart: `calc(${rowInset(inner)} + 0.5rem)` }">
        <span class="truncate">{{ $t("note.error.section_failed") }}</span>
      </li>
      <li v-else-if="rows.rows.length === 0 && props.node.children.length === 0" class="flex h-8 items-center pe-3 text-sm text-dimmed" :style="{ paddingInlineStart: `calc(${rowInset(inner)} + 0.5rem)` }" data-empty-folder>
        <span class="truncate">{{ $t("note.empty.folder") }}</span>
      </li>
      <template v-else>
        <li v-for="note in rows.rows" :key="`${note.owner}/${note.id}`">
          <NoteRow :note="note" :depth="inner" :chosen="props.chosen === `${note.owner}/${note.id}`" :items="props.itemsOf(note)" :href="props.hrefOf(note)" @open="emit('open', note, $event)" />
        </li>
      </template>
      <li v-if="rows !== null && rows.more" ref="end" aria-hidden="true">
        <div v-if="rows.appending" class="flex h-8 items-center gap-2 px-4">
          <USkeleton class="size-4.5 shrink-0 rounded-sm" />
          <USkeleton class="h-3.5 w-2/5 rounded-sm" />
        </div>
        <div v-else class="h-8" />
      </li>
    </ul>
  </li>
</template>
