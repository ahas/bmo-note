<script setup lang="ts">
// The page head (`docs/design.md`, 「The console surface」): the note's icon, large, standing over the title
// the editor draws as the document's own title node, in the editor's column at the top of the document's
// scroll. A
// note with no icon offers a key to add one while the pointer is over the head or the keyboard's focus is
// in it; the icon key opens a popover of a small set of emoji and a key that removes the icon. A reader who
// cannot write the note sees the icon and nothing to press.

import { ref } from "vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";

import { NOTE_ICONS } from "../domain/icons";

const props = defineProps<{ icon: string; writable: boolean; busy: boolean }>();

const emit = defineEmits<{ pick: [icon: string] }>();

const open = ref(false);

function pick(icon: string): void {
  open.value = false;
  emit("pick", icon);
}
</script>

<template>
  <div class="note-head group/head" data-note-head>
    <span v-if="!props.writable && props.icon !== ''" class="block text-5xl leading-none" aria-hidden="true">{{ props.icon }}</span>

    <UPopover v-else-if="props.writable" v-model:open="open" :content="{ align: 'start', side: 'bottom' }">
      <HintTip v-if="props.icon !== ''" :text="$t('note.action.change_icon')" press class="inline-flex">
        <UButton color="neutral" variant="ghost" class="p-1 text-5xl leading-none" :loading="props.busy" :aria-label="$t('note.action.change_icon')">{{ props.icon }}</UButton>
      </HintTip>
      <UButton
        v-else
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-material-symbols-add-reaction-outline"
        :label="$t('note.action.add_icon')"
        :loading="props.busy"
        class="text-muted opacity-0 group-hover/head:opacity-100 group-focus-within/head:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 data-[state=open]:opacity-100"
      />

      <template #content>
        <div class="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 p-2">
          <div class="grid grid-cols-8 gap-1" role="group" :aria-label="$t('note.label.picked_icon')">
            <UButton
              v-for="icon in NOTE_ICONS"
              :key="icon"
              color="neutral"
              :variant="icon === props.icon ? 'soft' : 'ghost'"
              square
              class="justify-center text-xl leading-none"
              :aria-label="icon"
              :aria-pressed="icon === props.icon"
              @click="pick(icon)"
            >
              {{ icon }}
            </UButton>
          </div>
          <div v-if="props.icon !== ''" class="flex justify-end border-t border-default pt-2">
            <UButton color="neutral" variant="ghost" size="sm" icon="i-material-symbols-delete-outline" :label="$t('note.action.remove_icon')" @click="pick('')" />
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>

<style scoped>
/* The head stands in the editor's own column, inset as its title is, so the icon lines up with the title's
   first letter whatever width the note stands at. */
.note-head {
  padding-top: 24px;
  padding-bottom: 8px;
  min-height: 56px;
}

@media (min-width: 640px) {
  .note-head {
    padding-inline: 2rem;
  }
}
</style>
