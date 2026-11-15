<script setup lang="ts">
// One row of the navigator (`docs/design.md`, 「The console surface」): the note's icon and its title on one
// line, the open note's row standing chosen. A press opens the note, Ctrl or ⌘ held opens it in a new tab;
// the row's actions are one menu, from the `…` key standing while the pointer or the keyboard's focus is
// on the row, from a right press and from a held finger, the last through the layer's one long press.

import { computed, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";
import { useHoldMenu } from "bmo-ui/app/domain/holdmenu";

import { NOTE_MARK } from "../domain/icons";

import type { DropdownMenuItem } from "@nuxt/ui";
import type { NoteMeta } from "../../shared/types";

const props = defineProps<{
  note: NoteMeta;
  chosen: boolean;
  /** The row's actions, in the order they are reached for. */
  items: DropdownMenuItem[][];
  /** Where the row leads, as an address the browser can open in a new tab. */
  href: string;
}>();

const emit = defineEmits<{ open: [event: MouseEvent] }>();

const i18n = useI18n();
const surface = useTemplateRef<HTMLElement>("surface");

useHoldMenu({ surface: () => surface.value });

const title = computed(() => (props.note.title === "" ? i18n.t("note.label.untitled") : props.note.title));

function pressed(event: MouseEvent): void {
  // A press with Ctrl or ⌘ held, or the middle button, is the browser's own: the link opens in a new tab.
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;

  event.preventDefault();
  emit("open", event);
}
</script>

<template>
  <UContextMenu :items="props.items" :modal="false">
    <div ref="surface" class="group/row relative px-2" :data-note="`${props.note.owner}/${props.note.id}`">
      <a
        :href="props.href"
        class="focus-inset flex h-8 min-w-0 items-center gap-2 rounded-md ps-2 pe-9 text-sm transition-colors select-none"
        :class="props.chosen ? 'bg-elevated font-medium text-highlighted hover:bg-accented/75 active:bg-accented' : 'text-default hover:bg-elevated active:bg-accented'"
        :aria-current="props.chosen ? 'page' : undefined"
        draggable="false"
        @click="pressed"
      >
        <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
          <span v-if="props.note.icon !== ''" class="text-base leading-none">{{ props.note.icon }}</span>
          <UIcon v-else :name="NOTE_MARK" class="size-4.5 text-dimmed" />
        </span>
        <HintTip :text="title" cut press class="block min-w-0 flex-1 truncate" :class="props.note.title === '' ? 'text-dimmed' : ''">{{ title }}</HintTip>
      </a>
      <!-- The menu key stands over the row's trailing end, inside the room the row keeps clear for it. -->
      <span class="absolute inset-y-0 end-3 flex items-center opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100 has-[[data-state=open]]:opacity-100">
        <UDropdownMenu :items="props.items" :content="{ align: 'end' }">
          <IconButton :label="$t('note.action.more')" icon="i-material-symbols-more-horiz" size="xs" />
        </UDropdownMenu>
      </span>
    </div>
  </UContextMenu>
</template>
