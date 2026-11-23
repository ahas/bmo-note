<script setup lang="ts">
// One folder's row in the navigator's tree (`docs/design.md`, 「The console surface」): the fold mark, the folder
// mark and its name on one line, one step further in for each folder it stands in. A press folds or unfolds it;
// its actions are one menu, from the `…` key, a right press and a held finger, as a note row's are, and F2 and
// Delete answer while the row holds the focus. Its name opens in the row for renaming: Enter or leaving the field
// keeps what it holds, Escape the name it had. A row dragged under a pointer onto it lands in it, which it says
// by its tint while the row is held over it.

import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";
import { useHoldMenu } from "bmo-ui/app/domain/holdmenu";

import { draggedRow, endDrag, startDrag } from "../domain/drag";
import { rowInset } from "../domain/navigator";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { HeldRow } from "../domain/drag";
import type { NoteFolder } from "../../shared/types";

const props = defineProps<{
  folder: NoteFolder;
  depth: number;
  open: boolean;
  /** Whether its name stands open in the row. */
  naming: boolean;
  /** Whether a bookmark just brought it into sight, which it wears a moment. */
  shown: boolean;
  items: DropdownMenuItem[][];
  /** Whether a held row may land in this folder. */
  takes: (row: HeldRow) => boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  name: [name: string | null];
  drop: [row: HeldRow];
  key: [key: "rename" | "delete"];
}>();

const surface = useTemplateRef<HTMLElement>("surface");
const field = useTemplateRef<{ inputRef?: HTMLInputElement }>("field");
const typed = ref(props.folder.name);
const over = ref(false);

useHoldMenu({ surface: () => surface.value });

// Whether the open field has been answered, so Enter and the blur that follows it keep the name once, and when it
// opened.
let settled = false;
let openedAt = 0;

// How long after the field opens a focus taken from it is still the press or the menu that opened it handing the
// focus on, rather than the reader leaving.
const SETTLE_MS = 400;

// The field opens holding the name, all of it chosen, so typing replaces it.
watch(
  () => props.naming,
  async (naming) => {
    if (!naming) return;

    settled = false;
    openedAt = performance.now();
    typed.value = props.folder.name;
    await nextTick();
    field.value?.inputRef?.focus();
    field.value?.inputRef?.select();
  },
  { immediate: true }
);

/** The name kept: what the field holds, or, empty, the name it had. */
function keepName(): void {
  if (settled) return;

  settled = true;

  const name = typed.value.trim();

  emit("name", name === "" || name === props.folder.name ? null : name);
}

// The menu a rename or a new folder was chosen from hands the focus back to its key as it closes, and the press
// that opened the field may take the focus as it ends; that leaving is theirs, not the reader's, so the field takes
// the focus again.
function leftField(event: FocusEvent): void {
  const to = event.relatedTarget as HTMLElement | null;

  if ((to !== null && to.closest("[aria-haspopup=menu]") !== null) || performance.now() - openedAt < SETTLE_MS) {
    requestAnimationFrame(() => field.value?.inputRef?.focus());

    return;
  }

  keepName();
}

function cancelName(): void {
  if (settled) return;

  settled = true;
  emit("name", null);
}

// A folder a bookmark brought into sight is scrolled to where it can be seen.
watch(
  () => props.shown,
  async (shown) => {
    if (!shown) return;

    await nextTick();
    surface.value?.scrollIntoView({ block: "nearest" });
  },
  { immediate: true }
);

function pressedKey(event: KeyboardEvent): void {
  if (props.naming) return;

  if (event.key === "F2") {
    event.preventDefault();
    emit("key", "rename");
  } else if (event.key === "Delete") {
    event.preventDefault();
    emit("key", "delete");
  }
}

const droppable = computed(() => over.value);

function overRow(event: DragEvent): void {
  const row = draggedRow(event);

  if (row === null || !props.takes(row)) return;

  event.preventDefault();

  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";

  over.value = true;
}

function dropped(event: DragEvent): void {
  const row = draggedRow(event);

  over.value = false;

  if (row === null || !props.takes(row)) return;

  event.preventDefault();
  endDrag();
  emit("drop", row);
}
</script>

<template>
  <UContextMenu :items="props.items" :modal="false" :disabled="props.naming">
    <div
      ref="surface"
      class="group/row relative px-2"
      :data-folder="props.folder.id"
      :draggable="!props.naming"
      @dragstart="startDrag($event, { kind: 'folder', id: props.folder.id })"
      @dragend="endDrag"
      @dragover="overRow"
      @dragleave="over = false"
      @drop="dropped"
      @contextmenu.stop
    >
      <div v-if="props.naming" class="flex h-8 min-w-0 items-center gap-2 pe-2" :style="{ paddingInlineStart: rowInset(props.depth) }">
        <span class="flex shrink-0 items-center" aria-hidden="true">
          <UIcon name="i-material-symbols-chevron-right" class="size-4 text-dimmed rtl:-scale-x-100" />
          <UIcon name="i-material-symbols-folder-outline" class="size-4.5 text-muted" />
        </span>
        <UInput
          ref="field"
          v-model="typed"
          size="sm"
          class="min-w-0 flex-1"
          :aria-label="$t('note.folder.name')"
          maxlength="100"
          data-folder-name
          @keydown.enter.prevent="keepName"
          @keydown.esc.prevent.stop="cancelName"
          @blur="leftField"
        />
      </div>
      <button
        v-else
        type="button"
        class="focus-inset flex h-8 w-full min-w-0 items-center gap-2 rounded-md pe-9 text-start text-sm text-default transition-colors select-none hover:bg-elevated active:bg-accented"
        :class="droppable ? 'bg-accented ring-1 ring-inset ring-primary' : props.shown ? 'bg-accented' : ''"
        :style="{ paddingInlineStart: rowInset(props.depth) }"
        :aria-expanded="props.open"
        @click="emit('toggle')"
        @keydown="pressedKey"
      >
        <span class="flex shrink-0 items-center" aria-hidden="true">
          <UIcon :name="props.open ? 'i-material-symbols-expand-more' : 'i-material-symbols-chevron-right'" class="size-4 text-dimmed rtl:-scale-x-100" />
          <UIcon :name="props.open ? 'i-material-symbols-folder-open-outline' : 'i-material-symbols-folder-outline'" class="size-4.5 text-muted" />
        </span>
        <HintTip :text="props.folder.name" cut press class="block min-w-0 flex-1 truncate">{{ props.folder.name }}</HintTip>
      </button>
      <span
        v-if="!props.naming"
        class="absolute inset-y-0 end-3 flex items-center opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100 has-[[data-state=open]]:opacity-100"
      >
        <UDropdownMenu :items="props.items" :content="{ align: 'end' }">
          <IconButton :label="$t('note.action.more')" icon="i-material-symbols-more-horiz" size="xs" />
        </UDropdownMenu>
      </span>
    </div>
  </UContextMenu>
</template>
