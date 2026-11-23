<script setup lang="ts">
// The note's comments at a glance (`docs/design.md`, 「Comments」): the comments key on the bar's trailing edge,
// carrying the count of open threads, opens a short list of the threads — the open ones in the order their words
// stand, then the ones whose words were deleted, then the resolved ones — each its quoted words on one line and
// how many comments it holds. Pressing one opens its thread in the note, under its words.

import { computed, ref } from "vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";

import type { Comments } from "../composables/useComments";
import type { NoteThread } from "../../shared/types";

const props = defineProps<{ comments: Comments }>();

const emit = defineEmits<{ open: [thread: string] }>();

const shown = ref(false);

const ordered = computed(() => props.comments.ordered.value);
const empty = computed(() => ordered.value.open.length + ordered.value.detached.length + ordered.value.resolved.length === 0);

const groups = computed(() =>
  [
    { id: "open", threads: ordered.value.open, label: null as string | null },
    { id: "detached", threads: ordered.value.detached, label: "note.comment.detached" },
    { id: "resolved", threads: ordered.value.resolved, label: "note.comment.resolved" }
  ].filter((group) => group.threads.length > 0)
);

function open(thread: NoteThread): void {
  shown.value = false;
  emit("open", thread.id);
}
</script>

<template>
  <UPopover v-model:open="shown" :content="{ align: 'end', collisionPadding: 16 }">
    <HintTip :text="$t('note.comment.title')" press>
      <UButton
        size="sm"
        color="neutral"
        :variant="shown ? 'subtle' : 'ghost'"
        icon="i-material-symbols-comment-outline"
        :label="props.comments.openCount.value > 0 ? new Intl.NumberFormat($i18n.locale).format(props.comments.openCount.value) : undefined"
        :aria-label="$t('note.comment.title')"
        :aria-expanded="shown"
        class="tabular-nums"
        data-comments-key
      />
    </HintTip>
    <template #content>
      <div class="flex max-h-[min(24rem,60vh)] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto overscroll-contain p-1" :aria-label="$t('note.comment.list')" data-comment-list>
        <p v-if="props.comments.stand.value === 'failed'" class="px-2 py-2 text-sm text-error">{{ $t("note.comment.read_failed") }}</p>
        <p v-else-if="empty" class="px-2 py-2 text-sm text-muted">{{ $t("note.comment.empty") }}</p>
        <template v-else>
          <section v-for="group in groups" :key="group.id" class="flex flex-col">
            <p v-if="group.label !== null" class="px-2 pt-2 pb-1 text-sm text-muted">{{ group.id === "resolved" ? $t(group.label, { n: group.threads.length }) : $t(group.label) }}</p>
            <button
              v-for="thread in group.threads"
              :key="thread.id"
              type="button"
              class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-start text-sm hover:bg-elevated active:bg-accented focus-visible:outline-2 focus-visible:outline-primary"
              :class="group.id === 'resolved' ? 'text-muted' : 'text-default'"
              :data-comment-row="thread.id"
              @click="open(thread)"
            >
              <span class="min-w-0 flex-1 truncate">{{ thread.quote }}</span>
              <span class="inline-flex shrink-0 items-center gap-1 text-muted tabular-nums">
                <UIcon name="i-material-symbols-chat-bubble-outline" class="size-4" />
                {{ new Intl.NumberFormat($i18n.locale).format(thread.comments.length) }}
              </span>
            </button>
          </section>
        </template>
      </div>
    </template>
  </UPopover>
</template>
