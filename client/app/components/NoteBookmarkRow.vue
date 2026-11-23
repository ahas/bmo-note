<script setup lang="ts">
// One bookmark's row in the navigator (`docs/design.md`, 「The console surface」): its mark and its name on one
// line — a folder's name, a note's icon and title, or a line's words with the note's title in its tooltip, a
// line whose block is gone in the dimmed tone saying so. A press opens what it names, Ctrl or ⌘ held opens a note
// in a new tab; its menu, from the `…` key, a right press and a held finger, takes the bookmark off.

import { computed, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";
import { useHoldMenu } from "bmo-ui/app/domain/holdmenu";

import { NOTE_MARK } from "../domain/icons";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { NoteBookmark } from "../../shared/types";

const props = defineProps<{
  bookmark: NoteBookmark;
  items: DropdownMenuItem[][];
  /** Where a note's or a line's bookmark leads, as an address the browser can open in a new tab. */
  href: string | null;
  chosen: boolean;
}>();

const emit = defineEmits<{ open: [event: MouseEvent] }>();

const i18n = useI18n();
const surface = useTemplateRef<HTMLElement>("surface");

useHoldMenu({ surface: () => surface.value });

const noteTitle = computed(() => {
  const title = props.bookmark.note?.title ?? "";

  return title === "" ? i18n.t("note.label.untitled") : title;
});

const gone = computed(() => props.bookmark.kind === "line" && !props.bookmark.anchored);

const name = computed(() => {
  switch (props.bookmark.kind) {
    case "folder":
      return props.bookmark.folder?.name ?? "";
    case "note":
      return noteTitle.value;
    default:
      return props.bookmark.quote !== null && props.bookmark.quote !== "" ? props.bookmark.quote : noteTitle.value;
  }
});

const tip = computed(() => {
  if (props.bookmark.kind !== "line") return name.value;

  return i18n.t("note.label.line_of", { title: noteTitle.value, line: gone.value ? i18n.t("note.label.line_gone") : name.value });
});

const icon = computed(() => {
  switch (props.bookmark.kind) {
    case "folder":
      return "i-material-symbols-folder-outline";
    case "note":
      return NOTE_MARK;
    default:
      return gone.value ? "i-material-symbols-link-off" : "i-material-symbols-format-quote-outline";
  }
});

const emoji = computed(() => (props.bookmark.kind === "note" ? (props.bookmark.note?.icon ?? "") : ""));

function pressed(event: MouseEvent): void {
  // A press with Ctrl or ⌘ held, or the middle button, on a note's is the browser's own: it opens in a new tab.
  if (props.href !== null && (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0)) return;

  event.preventDefault();
  emit("open", event);
}
</script>

<template>
  <UContextMenu :items="props.items" :modal="false">
    <div ref="surface" class="group/row relative px-2" :data-bookmark="props.bookmark.kind" @contextmenu.stop>
      <component
        :is="props.href === null ? 'button' : 'a'"
        :href="props.href ?? undefined"
        :type="props.href === null ? 'button' : undefined"
        class="focus-inset flex h-8 w-full min-w-0 items-center gap-2 rounded-md ps-2 pe-9 text-start text-sm transition-colors select-none"
        :class="props.chosen ? 'bg-elevated font-medium text-highlighted hover:bg-accented/75 active:bg-accented' : 'text-default hover:bg-elevated active:bg-accented'"
        draggable="false"
        @click="pressed"
      >
        <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
          <span v-if="emoji !== ''" class="text-base leading-none">{{ emoji }}</span>
          <UIcon v-else :name="icon" class="size-4.5 text-dimmed" />
        </span>
        <HintTip :text="tip" :cut="props.bookmark.kind !== 'line'" press class="block min-w-0 flex-1 truncate" :class="gone ? 'text-dimmed line-through' : ''">{{ name }}</HintTip>
      </component>
      <span class="absolute inset-y-0 end-3 flex items-center opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100 has-[[data-state=open]]:opacity-100">
        <UDropdownMenu :items="props.items" :content="{ align: 'end' }">
          <IconButton :label="$t('note.action.more')" icon="i-material-symbols-more-horiz" size="xs" />
        </UDropdownMenu>
      </span>
    </div>
  </UContextMenu>
</template>
