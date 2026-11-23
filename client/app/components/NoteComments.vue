<script setup lang="ts">
// The comments panel (`docs/design.md`, 「Comments」): the open threads in the order their words stand in the
// note, then the threads whose words were deleted, then the resolved ones folded under their own head. Each
// thread is its quoted words, its comments with their authors' names, its reply field and the actions the
// reader may take. A new thread's field stands first while the reader drafts one. Pressing a thread chooses
// its words in the note.

import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import { useIsland } from "bmo-ui/app/domain/island";
import { askQuestion } from "bmo-ui/app/domain/question";
import { useNarrow } from "bmo-ui/app/domain/screen";

import { clockOf } from "../domain/count";

import type { Comments } from "../composables/useComments";
import type { NoteThread } from "../../shared/types";

const props = defineProps<{
  comments: Comments;
  /** Whether the reader starts threads, replies, resolves and reopens. */
  writable: boolean;
  /** Whether the reader owns the note, and so deletes any comment. */
  owns: boolean;
  nameOf: (key: string) => string;
}>();

const chosen = defineModel<string | null>("chosen", { default: null });

const emit = defineEmits<{ show: [thread: string] }>();

const i18n = useI18n();
const island = useIsland((key: string) => i18n.t(key));
const phone = useNarrow();

/** Enter sends where a keyboard of keys stands; on a phone it breaks the line and the key sends. */
function enterSends(event: KeyboardEvent, send: () => void): void {
  if (phone.value || event.isComposing) return;

  event.preventDefault();
  send();
}

const drafting = ref("");
const replies = ref<Record<string, string>>({});
const busy = ref<string | null>(null);
const resolvedOpen = ref(false);

const ordered = computed(() => props.comments.ordered.value);
const draft = computed(() => props.comments.draft.value);
const empty = computed(() => ordered.value.open.length + ordered.value.detached.length + ordered.value.resolved.length === 0 && draft.value === null);

function momentOf(moment: number): string {
  const today = new Date().toDateString() === new Date(moment).toDateString();

  return today ? clockOf(moment, i18n.locale.value) : new Intl.DateTimeFormat(i18n.locale.value, { month: "short", day: "numeric" }).format(moment);
}

function authorOf(key: string, mine: boolean): string {
  return mine ? i18n.t("note.label.you") : props.nameOf(key);
}

/** Runs one write, the panel's keys held while it goes; a refusal is said on the pill. */
async function acting(id: string, work: () => Promise<unknown>): Promise<boolean> {
  if (busy.value !== null) return false;

  busy.value = id;

  try {
    await work();

    return true;
  } catch {
    island.say({ tone: "error", title: i18n.t("note.comment.failed") });

    return false;
  } finally {
    busy.value = null;
  }
}

async function startThread(): Promise<void> {
  const body = drafting.value.trim();

  if (body === "") return;

  let made: string | null = null;

  if (await acting("draft", async () => (made = await props.comments.start(body)))) {
    drafting.value = "";
    chosen.value = made;
  }
}

function cancelDraft(): void {
  props.comments.draft.value = null;
  drafting.value = "";
}

async function reply(thread: NoteThread): Promise<void> {
  const body = (replies.value[thread.id] ?? "").trim();

  if (body === "") return;

  if (await acting(thread.id, () => props.comments.reply(thread.id, body))) replies.value = { ...replies.value, [thread.id]: "" };
}

async function removeThread(thread: NoteThread): Promise<void> {
  const through = await askQuestion({ title: i18n.t("note.comment.delete_question"), effect: i18n.t("note.question.purge_effect"), confirm: i18n.t("note.block.delete") });

  if (through) await acting(thread.id, () => props.comments.removeThread(thread.id));
}

function show(thread: NoteThread): void {
  chosen.value = thread.id;

  if (thread.resolvedAt === null) emit("show", thread.id);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-comments>
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
      <!-- A new thread's field, over the words chosen. -->
      <form v-if="draft !== null" class="flex flex-col gap-2 rounded-md border border-primary/50 p-3" data-comment-draft @submit.prevent="startThread">
        <blockquote class="border-s-2 border-warning ps-2 text-sm break-words text-muted">{{ draft.quote }}</blockquote>
        <UTextarea
          v-model="drafting"
          autoresize
          :rows="2"
          :maxrows="8"
          autofocus
          :placeholder="$t('note.comment.placeholder')"
          :aria-label="$t('note.comment.add')"
          @keydown.enter.exact="(event: KeyboardEvent) => enterSends(event, () => void startThread())"
        />
        <div class="flex justify-end gap-2">
          <UButton size="sm" color="neutral" variant="ghost" :label="$t('note.action.cancel')" @click="cancelDraft" />
          <UButton type="submit" size="sm" :loading="busy === 'draft'" :disabled="drafting.trim() === ''" :label="$t('note.action.send')" />
        </div>
      </form>

      <div v-if="props.comments.stand.value === 'loading'" role="status" :aria-label="$t('note.status.loading')" class="flex flex-col gap-3">
        <USkeleton v-for="at in 2" :key="at" class="h-24 w-full rounded-md" />
      </div>

      <div v-else-if="props.comments.stand.value === 'failed'" role="alert" class="flex flex-col items-start gap-2 text-sm text-error">
        <p>{{ $t("note.comment.read_failed") }}</p>
        <UButton size="sm" color="neutral" variant="soft" icon="i-material-symbols-refresh" :label="$t('note.action.retry')" @click="props.comments.load()" />
      </div>

      <p v-else-if="empty" class="py-8 text-center text-sm text-muted">{{ $t("note.comment.empty") }}</p>

      <template v-else>
        <template v-for="group in (['open', 'detached'] as const)" :key="group">
          <article
            v-for="thread in ordered[group]"
            :key="thread.id"
            class="flex flex-col gap-2 rounded-md border p-3"
            :class="chosen === thread.id ? 'border-primary' : 'border-default'"
            :data-thread-card="thread.id"
          >
            <button type="button" class="rounded-sm text-start hover:bg-elevated active:bg-accented focus-visible:outline-2 focus-visible:outline-primary" @click="show(thread)">
              <blockquote class="border-s-2 border-warning ps-2 text-sm break-words text-muted">{{ thread.quote }}</blockquote>
              <p v-if="group === 'detached'" class="mt-1 text-sm text-dimmed">{{ $t("note.comment.detached") }}</p>
            </button>

            <div v-for="said in thread.comments" :key="said.id" class="group/said flex flex-col gap-0.5" data-comment>
              <div class="flex items-center gap-2 text-sm">
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
                    :disabled="busy !== null"
                    class="opacity-0 group-hover/said:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                    @click="acting(thread.id, () => props.comments.removeComment(thread.id, said.id))"
                  />
                </HintTip>
              </div>
              <p class="text-sm break-words whitespace-pre-wrap text-default">{{ said.body }}</p>
            </div>

            <form v-if="props.writable" class="flex items-end gap-2" @submit.prevent="reply(thread)">
              <UTextarea
                v-model="replies[thread.id]"
                autoresize
                :rows="1"
                :maxrows="6"
                class="min-w-0 flex-1"
                :placeholder="$t('note.comment.reply')"
                :aria-label="$t('note.comment.reply')"
                @keydown.enter.exact="(event: KeyboardEvent) => enterSends(event, () => void reply(thread))"
              />
              <UButton type="submit" size="sm" color="neutral" variant="subtle" icon="i-material-symbols-send" :aria-label="$t('note.action.send')" :loading="busy === thread.id" :disabled="(replies[thread.id] ?? '').trim() === ''" />
            </form>

            <div v-if="props.writable" class="flex flex-wrap justify-end gap-1">
              <UButton
                v-if="thread.mine || props.owns"
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-material-symbols-delete-outline"
                :label="$t('note.comment.delete_thread')"
                :disabled="busy !== null"
                @click="removeThread(thread)"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-material-symbols-check-circle-outline"
                :label="$t('note.comment.resolve')"
                :disabled="busy !== null"
                data-thread-resolve
                @click="acting(thread.id, () => props.comments.resolve(thread.id, true))"
              />
            </div>
          </article>
        </template>

        <!-- The resolved threads, folded under their own head. -->
        <section v-if="ordered.resolved.length > 0" class="flex flex-col gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="self-start"
            :trailing-icon="resolvedOpen ? 'i-material-symbols-expand-less' : 'i-material-symbols-expand-more'"
            :label="$t('note.comment.resolved', { n: ordered.resolved.length })"
            :aria-expanded="resolvedOpen"
            data-resolved-fold
            @click="resolvedOpen = !resolvedOpen"
          />
          <template v-if="resolvedOpen">
            <article v-for="thread in ordered.resolved" :key="thread.id" class="flex flex-col gap-2 rounded-md border border-default p-3 opacity-80" :data-thread-card="thread.id">
              <blockquote class="border-s-2 border-default ps-2 text-sm break-words text-muted">{{ thread.quote }}</blockquote>
              <div v-for="said in thread.comments" :key="said.id" class="flex flex-col gap-0.5">
                <div class="flex items-center gap-2 text-sm">
                  <span class="min-w-0 truncate font-medium text-highlighted">{{ authorOf(said.author, said.mine) }}</span>
                  <span class="shrink-0 text-muted tabular-nums">{{ momentOf(said.createdAt) }}</span>
                </div>
                <p class="text-sm break-words whitespace-pre-wrap text-default">{{ said.body }}</p>
              </div>
              <div v-if="props.writable" class="flex justify-end">
                <UButton
                  size="sm"
                  color="neutral"
                  variant="ghost"
                  icon="i-material-symbols-replay"
                  :label="$t('note.comment.reopen')"
                  :disabled="busy !== null"
                  data-thread-reopen
                  @click="acting(thread.id, () => props.comments.resolve(thread.id, false))"
                />
              </div>
            </article>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>
