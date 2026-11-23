<script setup lang="ts">
// The column beside the open note (`docs/design.md`, 「The AI talk panel」, 「Comments」): docked beside the
// document on a wide viewport — a column of its own, parted from the document by one line, standing in the
// row the note fills — and rising from the bottom edge as a drawer below that width. The talk and the
// comments each stand in it, one at a time.

import { onBeforeUnmount, onMounted, ref } from "vue";
import UDrawer from "@nuxt/ui/components/Drawer.vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import { useNarrow } from "bmo-ui/app/domain/screen";

/// Where the panel stops being a drawer and stands as a column of its own beside the note.
const DOCK_QUERY = "(min-width: 1024px)";

const props = defineProps<{
  /** The panel's name, standing in its head. */
  title: string;
  /** The name of its width handle. */
  widthLabel: string;
}>();

const open = defineModel<boolean>("open", { default: false });

const docked = useNarrow(DOCK_QUERY);

// The docked panel is put away by Escape, as the drawer it replaces is.
function onEscape(event: KeyboardEvent): void {
  if (docked.value && open.value && event.key === "Escape") {
    event.preventDefault();
    open.value = false;
  }
}

onMounted(() => {
  addEventListener("keydown", onEscape);
  width.value = keptWidth();
});
onBeforeUnmount(() => removeEventListener("keydown", onEscape));

// The docked panel's width: dragged at its leading edge or stepped by the arrow keys, held between its
// bounds, and kept in this browser for the next note. A browser that keeps nothing opens at the default.
//
// The panel is a column of its own beside the note and never lies over it. Its worn width is the kept
// one clamped by the row it stands in: the note keeps a readable column wherever the row has room for
// one, and below that the panel holds the floor a chat line and its input need. The clamp is the
// browser's (`max-width` and `min-width` on the column), so it follows the console's frame — a sidebar
// takes its share of every window differently — and the kept value stays as it was, a wider row
// bringing it back.
const WIDTH_MIN = 260;
const WIDTH_MAX = 640;
const WIDTH_DEFAULT = 320;
const WIDTH_STEP = 16;
const WIDTH_KEY = "bmo-note-panel-width";

// The narrowest note column the screen gives a panel to: the editor's own room to read and write in,
// the page padding and the caret's column included.
const NOTE_MIN = 480;

// How narrow a chat column can be made and still hold a message line and its input; where the row
// leaves less than the note's minimum and this floor together, this wins, an overlap of padding being
// what it prevents rather than a chat no one can read.
const PANEL_FLOOR = 200;

const width = ref(WIDTH_DEFAULT);
const dragging = ref(false);

function clampWidth(value: number): number {
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(value)));
}

function keptWidth(): number {
  try {
    const kept = Number(localStorage.getItem(WIDTH_KEY));

    return Number.isFinite(kept) && kept > 0 ? clampWidth(kept) : WIDTH_DEFAULT;
  } catch {
    return WIDTH_DEFAULT;
  }
}

function setWidth(value: number): void {
  width.value = clampWidth(value);

  try {
    localStorage.setItem(WIDTH_KEY, String(width.value));
  } catch {
    // A browser that keeps nothing still resizes for this visit.
  }
}

// Leftward widens: the panel stands at the trailing edge, so its width grows as the edge moves left.
function onDragStart(event: PointerEvent): void {
  if (event.button !== 0) return;

  event.preventDefault();

  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = width.value;

  dragging.value = true;

  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    // A pointer the browser will not let us hold is still one we can follow while it is down.
  }

  const onMove = (moved: PointerEvent): void => {
    width.value = clampWidth(startWidth + (startX - moved.clientX));
  };

  const onUp = (): void => {
    dragging.value = false;
    setWidth(width.value);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
  };

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}

defineExpose({ docked });
</script>

<template>
  <aside
    v-if="docked && open"
    class="relative flex shrink-0 flex-col border-s border-default bg-default"
    :style="{ width: `${width}px`, minWidth: `${PANEL_FLOOR}px`, maxWidth: `calc(100% - ${NOTE_MIN}px)` }"
    :aria-label="props.title"
  >
    <!-- The leading edge is the handle, as on the console's own side panel: dragging it sets the width,
         the arrow keys step it, and the width is kept for the next note. The line inside lights the
         panel's own border while a drag runs rather than standing a second line beside it. -->
    <div
      class="absolute inset-y-0 -start-1 z-10 w-2 cursor-col-resize focus-visible:bg-primary/40 focus-visible:outline-none"
      role="separator"
      aria-orientation="vertical"
      :aria-label="props.widthLabel"
      :aria-valuenow="width"
      :aria-valuemin="WIDTH_MIN"
      :aria-valuemax="WIDTH_MAX"
      tabindex="0"
      @pointerdown="onDragStart"
      @keydown.left.prevent="setWidth(width + WIDTH_STEP)"
      @keydown.right.prevent="setWidth(width - WIDTH_STEP)"
    >
      <div class="absolute inset-y-0 end-1/2 w-px transition-colors" :class="dragging ? 'bg-primary' : ''" />
    </div>

    <!-- The head stands at the format bar's height, so the two bottom edges are one line across. -->
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-default ps-4 pe-1 pointer-coarse:h-10">
      <!-- The editor's stylesheets stretch a bare span over any utility class, so its place is set on it. -->
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted" style="align-self: center">{{ props.title }}</span>
      <HintTip :text="$t('note.action.close')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-close" :aria-label="$t('note.action.close')" @click="open = false" />
      </HintTip>
    </div>

    <div class="flex min-h-0 flex-1 flex-col p-4">
      <slot />
    </div>
  </aside>

  <!-- Below that width the panel rises from the bottom edge, and the note waits behind it. -->
  <UDrawer
    v-if="!docked"
    v-model:open="open"
    :ui="{ content: 'h-[85svh]', container: 'min-h-0 flex-1 overflow-hidden', body: 'flex min-h-0 flex-1 flex-col' }"
    :title="props.title"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <slot />
      </div>
    </template>
  </UDrawer>
</template>
