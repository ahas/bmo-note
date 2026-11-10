<script setup lang="ts">
// The format bar over the editor (`docs/design.md`, 「The console surface」): the inline marks, the
// kinds a line turns into, the image upload and the table insert, in one standing row. It holds no
// formatting of its own — every press rides the vendored editor's command chain through
// `app/domain/format`, the same mechanism the hotkeys and the slash menu ride. While the editor is
// still mounting, or where nothing stands written that a key could change, those keys stand disabled;
// a file past the store's cap is told through the `failed` line the screen owns.

import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import ToolBar from "bmo-ui/app/components/ToolBar.vue";
import { BlockSelection, TextSelection } from "@blocksuite/affine/std";

import { activeConversion, activeMarks, barConversions, barMarks, convert, conversionsSupported, insertImages, insertTable } from "../domain/format";

import type { BarConversion } from "../domain/format";
import type { BlockStdScope } from "@blocksuite/affine/std";
import type { Subscription } from "rxjs";

const props = defineProps<{ std: BlockStdScope | null }>();

const emit = defineEmits<{ inserted: []; failed: []; ask: [] }>();

const i18n = useI18n();

const marks = ref<boolean[]>(barMarks.map(() => false));
const heldMarks = ref<boolean[]>(barMarks.map(() => false));
const heldLine = ref<string | null>(null);
const conversion = ref(-1);
const writable = ref(false);
const working = ref(false);
const picked = shallowRef<HTMLInputElement | null>(null);

let stop: Subscription | null = null;

const kindItems = computed(() =>
  barConversions.map((item) => ({
    label: i18n.t(`note.kind.${kindKey(item)}`),
    icon: item.icon,
    disabled: !writable.value,
    onSelect: () => turn(item)
  }))
);

const kindIcon = computed(() => (conversion.value < 0 ? "i-material-symbols-text-fields" : (barConversions[conversion.value]?.icon ?? "i-material-symbols-text-fields")));

const markIcons: Record<string, string> = {
  bold: "i-material-symbols-format-bold",
  italic: "i-material-symbols-format-italic",
  underline: "i-material-symbols-format-underlined",
  strike: "i-material-symbols-format-strikethrough",
  code: "i-material-symbols-code"
};

function kindKey(conversion: BarConversion): string {
  if (conversion.flavour === "affine:code") return "code";

  return String(conversion.type ?? "text");
}

function refresh(): void {
  const std = props.std;

  if (std === null) {
    marks.value = barMarks.map(() => false);
    conversion.value = -1;
    writable.value = false;

    return;
  }

  // The fork reads an active mark only for a one-element range, so a whole-word selection shows no
  // key lit though the marks land on it. The button takes its pressed state from the click that
  // landed the mark and holds it until the caret moves to another line.
  writable.value = conversionsSupported(std);
  conversion.value = activeConversion(std);

  const line = currentLine(std);

  if (line !== heldLine.value) {
    heldMarks.value = barMarks.map(() => false);
    heldLine.value = line;
  }

  marks.value = activeMarks(std).map((active, at) => active || (heldMarks.value[at] ?? false));
}

function currentLine(std: BlockStdScope): string | null {
  const text = std.selection.find(TextSelection);

  if (text !== undefined) return text.from.blockId;

  return std.selection.find(BlockSelection)?.blockId ?? null;
}

// The editor's scope arrives when its container is mounted, after this row stands; the row follows
// it, watching the fork's own selection stream for every beat after.
watch(
  () => props.std,
  (std) => {
    stop?.unsubscribe();
    stop = std === null ? null : std.selection.slots.changed.subscribe(refresh);
    refresh();
  },
  { immediate: true }
);

onBeforeUnmount(() => stop?.unsubscribe());

function toggle(id: string): void {
  const config = barMarks.find((item) => item.id === id);

  if (props.std === null || config === undefined) return;

  config.action(props.std.host);

  const at = barMarks.findIndex((item) => item.id === id);
  const wasOn = marks.value[at] ?? false;

  heldMarks.value = barMarks.map((_, i) => (i === at ? !wasOn : false));
  refresh();
}

function turn(item: BarConversion): void {
  if (props.std === null) return;

  convert(props.std, item);
  refresh();
}

function pickImage(): void {
  picked.value?.click();
}

async function standChosen(): Promise<void> {
  const input = picked.value;
  const files = [...(input?.files ?? [])];

  if (input !== null) input.value = "";

  if (props.std === null || files.length === 0 || working.value) return;

  working.value = true;

  try {
    const stood = await insertImages(props.std, files);

    if (stood.length > 0) emit("inserted");
  } catch {
    emit("failed");
  } finally {
    working.value = false;
    refresh();
  }
}

function addTable(): void {
  if (props.std === null) return;

  if (insertTable(props.std)) emit("inserted");
  refresh();
}
</script>

<template>
  <!-- `@mousedown.prevent` keeps the caret and selection in the document: the fork's mark and kind
       commands run against the editor's own range, and a control that took focus would take the
       selection with it. Keys reachable by Tab still ring on focus, as every control does. The row
       stays one row at a phone's width and scrolls its keys sideways, as the mobile rule asks. -->
  <ToolBar :label="$t('note.label.toolbar')" @mousedown.prevent>
    <!-- The bar spans the page; its keys gather in one row of their own width, centred, rather than
         spreading across a wide screen. Ask AI leads it, as it leads the selection toolbar, and stands
         whenever the editor does: with nothing selected and no caret it asks over the whole note. -->
    <div class="mx-auto flex h-full w-max shrink-0 items-center gap-1" data-bar-row>
      <HintTip :text="$t('note.ask.key')" press>
        <UButton
          size="lg"
          color="primary"
          variant="ghost"
          class="pointer-coarse:h-10"
          icon="i-material-symbols-auto-awesome-outline"
          :label="$t('note.ask.key')"
          :disabled="props.std === null"
          data-bar="ask"
          @click="emit('ask')"
        />
      </HintTip>

      <div class="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <HintTip :text="$t('note.action.turn_into')" press>
        <UDropdownMenu :items="[kindItems]" :disabled="!writable" :content="{ align: 'start' }">
          <UButton
            size="lg"
            color="neutral"
            variant="ghost"
            class="pointer-coarse:h-10"
            :icon="kindIcon"
            trailing-icon="i-material-symbols-expand-more"
            :disabled="!writable"
            :aria-label="$t('note.action.turn_into')"
            data-bar="kind"
          />
        </UDropdownMenu>
      </HintTip>

      <div class="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <HintTip v-for="(config, at) in barMarks" :key="config.id" :text="$t(`note.mark.${config.id}`)" press>
        <UButton
          size="lg"
          color="neutral"
          :variant="marks[at] ? 'subtle' : 'ghost'"
          square
          class="pointer-coarse:size-10"
          :icon="markIcons[config.id] ?? 'i-material-symbols-text-fields'"
          :disabled="!writable"
          :aria-label="$t(`note.mark.${config.id}`)"
          :data-bar="config.id"
          @click="toggle(config.id)"
        />
      </HintTip>

      <div class="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <HintTip :text="$t('note.action.image')" press>
        <UButton
          size="lg"
          color="neutral"
          variant="ghost"
          square
          class="pointer-coarse:size-10"
          icon="i-material-symbols-add-photo-alternate"
          :loading="working"
          :disabled="!writable || working"
          :aria-label="$t('note.action.image')"
          data-bar="image"
          @click="pickImage"
        />
      </HintTip>

      <HintTip :text="$t('note.action.table')" press>
        <UButton
          size="lg"
          color="neutral"
          variant="ghost"
          square
          class="pointer-coarse:size-10"
          icon="i-material-symbols-grid-view"
          :disabled="!writable || working"
          :aria-label="$t('note.action.table')"
          data-bar="table"
          @click="addTable"
        />
      </HintTip>

      <!-- The input the image action opens, never drawn: the native attribute, which the bundle's own
           stylesheet holds hidden against the editor's injected `input` rule. -->
      <input ref="picked" type="file" accept="image/*" multiple hidden data-bar="file" @change="standChosen" />
    </div>

    <!-- What acts on the whole note rather than the selection stands apart at the bar's trailing edge. -->
    <div v-if="$slots.end" class="flex shrink-0 items-center">
      <slot name="end" />
    </div>
  </ToolBar>
</template>
