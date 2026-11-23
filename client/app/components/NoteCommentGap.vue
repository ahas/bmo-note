<script setup lang="ts">
// A comment in the flow of the note (`docs/design.md`, 「Comments」): the gap the editor parts under the words a
// comment is laid on holds either a new thread's field or one thread — its comments with their authors' names, its
// reply field and its actions, resolve or reopen and the deletes the reader may make. A thread whose words were
// deleted from the note says so above its quoted words. The close key and Escape put the gap away. The gap stands
// inside the editor's document, whose prose styles reach every list, paragraph and quote under it, so the gap
// draws its parts from plain boxes alone.

import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import IconButton from "bmo-ui/app/components/IconButton.vue";
import { useIsland } from "bmo-ui/app/domain/island";
import { askQuestion } from "bmo-ui/app/domain/question";
import { useNarrow } from "bmo-ui/app/domain/screen";

import { clockOf } from "../domain/count";

import type { Comments } from "../composables/useComments";
import type { NoteThread } from "../../shared/types";

const props = defineProps<{
  comments: Comments;
  /** The thread standing in the gap; null while a new thread's field stands there. */
  thread: string | null;
  /** Whether the reader starts threads, replies, resolves and reopens. */
  writable: boolean;
  /** Whether the reader owns the note, and so deletes any comment. */
  owns: boolean;
  nameOf: (key: string) => string;
}>();

// `started` names the thread a new field's first comment made; `close` puts the gap away.
const emit = defineEmits<{ started: [thread: string]; close: [] }>();

const i18n = useI18n();
const island = useIsland((key: string) => i18n.t(key));
const phone = useNarrow();

const written = ref("");
const busy = ref(false);

const shown = computed<NoteThread | null>(() => (props.thread === null ? null : (props.comments.threads.value.find((one) => one.id === props.thread) ?? null)));
const detached = computed(() => shown.value !== null && !props.comments.places.value.has(shown.value.id));
const resolved = computed(() => shown.value !== null && shown.value.resolvedAt !== null);

/** Enter sends where a keyboard of keys stands; on a phone it breaks the line and the key sends. */
function enterSends(event: KeyboardEvent): void {
  if (phone.value || event.isComposing) return;

  event.preventDefault();
  void send();
}

function momentOf(moment: number): string {
  const today = new Date().toDateString() === new Date(moment).toDateString();

  return today ? clockOf(moment, i18n.locale.value) : new Intl.DateTimeFormat(i18n.locale.value, { month: "short", day: "numeric" }).format(moment);
}

function authorOf(key: string, mine: boolean): string {
  return mine ? i18n.t("note.label.you") : props.nameOf(key);
}

/** Runs one write, the gap's keys held while it goes; a refusal is said on the pill. */
async function acting(work: () => Promise<unknown>): Promise<boolean> {
  if (busy.value) return false;

  busy.value = true;

  try {
    await work();

    return true;
  } catch {
    island.say({ tone: "error", title: i18n.t("note.comment.failed") });

    return false;
  } finally {
    busy.value = false;
  }
}

/** Sends what the field holds: a new thread's first comment, or a reply under the thread. */
async function send(): Promise<void> {
  const body = written.value.trim();

  if (body === "") return;

  const held = shown.value;

  if (held === null) {
    let made: string | null = null;

    if (await acting(async () => (made = await props.comments.start(body)))) {
      written.value = "";
      if (made !== null) emit("started", made);
    }

    return;
  }

  if (await acting(() => props.comments.reply(held.id, body))) written.value = "";
}

async function removeThread(thread: NoteThread): Promise<void> {
  const through = await askQuestion({ title: i18n.t("note.comment.delete_question"), effect: i18n.t("note.question.purge_effect"), confirm: i18n.t("note.block.delete") });

  if (through && (await acting(() => props.comments.removeThread(thread.id)))) emit("close");
}

async function removeComment(thread: NoteThread, comment: string): Promise<void> {
  const last = thread.comments.length === 1;

  if ((await acting(() => props.comments.removeComment(thread.id, comment))) && last) emit("close");
}
</script>

<template>
  <section
    class="flex flex-col gap-2 rounded-lg border border-default bg-default p-3 text-sm shadow-sm"
    :aria-label="props.thread === null ? $t('note.comment.add') : $t('note.comment.title')"
    data-comment-thread
    :data-thread-id="props.thread ?? undefined"
    @keydown.esc.stop="emit('close')"
  >
    <!-- The head: what stands here, the thread's actions and the close key, on one centre line. -->
    <div class="flex min-h-8 items-center gap-1">
      <UIcon name="i-material-symbols-comment-outline" class="size-4 shrink-0 text-muted" />
      <span class="ms-1 min-w-0 flex-1 truncate font-medium text-highlighted">{{ props.thread === null ? $t("note.comment.add") : $t("note.comment.title") }}</span>
      <template v-if="shown !== null && props.writable">
        <UButton
          v-if="!resolved"
          size="sm"
          color="neutral"
          variant="ghost"
          icon="i-material-symbols-check-circle-outline"
          :label="$t('note.comment.resolve')"
          :disabled="busy"
          data-thread-resolve
          @click="acting(() => props.comments.resolve(shown!.id, true))"
        />
        <UButton
          v-else
          size="sm"
          color="neutral"
          variant="ghost"
          icon="i-material-symbols-replay"
          :label="$t('note.comment.reopen')"
          :disabled="busy"
          data-thread-reopen
          @click="acting(() => props.comments.resolve(shown!.id, false))"
        />
        <IconButton
          v-if="shown.mine || props.owns"
          :label="$t('note.comment.delete_thread')"
          icon="i-material-symbols-delete-outline"
          size="sm"
          :disabled="busy"
          data-thread-delete
          @click="removeThread(shown)"
        />
      </template>
      <IconButton :label="$t('note.action.close')" icon="i-material-symbols-close" size="sm" data-comment-close @click="emit('close')" />
    </div>

    <!-- A thread whose words were deleted from the note keeps them, quoted, under a line saying so. -->
    <template v-if="shown !== null && detached">
      <div class="text-muted">{{ $t("note.comment.detached") }}</div>
      <div class="border-s-2 border-default ps-2 break-words text-muted">{{ shown.quote }}</div>
    </template>

    <div v-if="props.thread !== null && shown === null" class="text-muted">{{ props.comments.stand.value === "failed" ? $t("note.comment.read_failed") : $t("note.status.loading") }}</div>

    <div v-if="shown !== null" role="list" class="flex flex-col gap-2">
      <div v-for="said in shown.comments" :key="said.id" role="listitem" class="group/said flex flex-col" data-comment>
        <div class="flex min-h-8 items-center gap-2">
          <span class="min-w-0 truncate font-medium text-highlighted">{{ authorOf(said.author, said.mine) }}</span>
          <span class="shrink-0 text-muted tabular-nums">{{ momentOf(said.createdAt) }}</span>
          <HintTip v-if="props.writable && (said.mine || props.owns)" :text="$t('note.comment.delete')" press class="ms-auto">
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              square
              icon="i-material-symbols-delete-outline"
              :aria-label="$t('note.comment.delete')"
              :disabled="busy"
              class="opacity-0 group-hover/said:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              @click="removeComment(shown, said.id)"
            />
          </HintTip>
        </div>
        <div class="break-words whitespace-pre-wrap text-default">{{ said.body }}</div>
      </div>
    </div>

    <!-- The field: a new thread's first comment, or a reply under the thread's last. -->
    <form v-if="props.writable && (props.thread === null || shown !== null)" class="flex items-end gap-2" @submit.prevent="send">
      <UTextarea
        v-model="written"
        autoresize
        :rows="1"
        :maxrows="6"
        :autofocus="props.thread === null"
        class="min-w-0 flex-1"
        :placeholder="props.thread === null ? $t('note.comment.placeholder') : $t('note.comment.reply')"
        :aria-label="props.thread === null ? $t('note.comment.placeholder') : $t('note.comment.reply')"
        data-comment-field
        @keydown.enter.exact="enterSends"
      />
      <HintTip :text="$t('note.action.send')" press>
        <UButton type="submit" size="md" color="primary" variant="soft" square icon="i-material-symbols-send" :aria-label="$t('note.action.send')" :loading="busy" :disabled="written.trim() === ''" data-comment-send />
      </HintTip>
    </form>
  </section>
</template>
