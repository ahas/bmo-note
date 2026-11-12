<script setup lang="ts">
// The notes list: the account's own, newest changed first, with the trash kept a view away. The head
// names the screen where the console offers no bar and carries the view switch and the new-note
// action; a row reads title first, then what the note holds and when it changed. A row opens its
// note; its actions stand at its right. The list is built again on the way back from a note and finds
// its place: the scroll stands where it was, and the row just read is kept in sight and marked for a
// breath (`docs/design.md`, 「The console surface」).

import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "@nuxt/ui/composables/useToast";
import HintTip from "bmo-ui/app/components/HintTip.vue";

import { rememberVisit, takeVisit, useNotes } from "../../composables/useNotes";
import { sizeOf } from "../../domain/count";

import type { NoteMeta } from "../../../shared/types";

/// How long the row the reader came back from wears its mark: a breath to find it in, not a state.
const FLASH_MS = 1_600;

const i18n = useI18n();
const router = useRouter();
const notes = useNotes();
const toast = useToast();

// The console's bar, where it offers one: it names the screen, so this one draws no title of its own. Nothing is
// laid into it; the view switch and the new-note key stand in the screen's own row under it.
const consoleBar = inject<object | null>("bmo-console-title-bar", null);

const confirming = ref<string | null>(null);
const working = ref<string | null>(null);
const retrying = ref(false);

const live = computed(() => notes.view.value === "live");

// The list is built again on the way back from a note: the scroll left where it was, and the row just
// read is found, kept in sight, and marked for a breath. Where the row is gone — trashed meanwhile, or
// past what the first page holds — the saved scroll stands on its own.
const list = useTemplateRef<HTMLElement>("list");
const justRead = ref<string | null>(null);

let flashTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  void notes.load().then(() => void returnToVisit());
});

onBeforeUnmount(() => {
  if (flashTimer !== null) clearTimeout(flashTimer);
});

async function returnToVisit(): Promise<void> {
  const left = takeVisit();

  if (left === null) return;

  await nextTick();

  const box = list.value;

  if (box === null) return;

  box.scrollTop = left.top;

  const row = box.querySelector(`li[data-note="${CSS.escape(left.id)}"]`);

  // The scroll stands as it was. Where the row the reader came back from no longer falls in it —
  // moved by a save, or not held by the first page — the row is brought into sight instead.
  if (row !== null) {
    const held = row.getBoundingClientRect();
    const view = box.getBoundingClientRect();

    if (held.top < view.top || held.bottom > view.bottom) row.scrollIntoView({ block: "nearest" });

    justRead.value = left.id;
    flashTimer = setTimeout(() => {
      flashTimer = null;
      justRead.value = null;
    }, FLASH_MS);
  }
}

function open(note: NoteMeta): void {
  if (!live.value) return;

  rememberVisit(note.id, list.value?.scrollTop ?? 0);

  void router.push(`/note/${encodeURIComponent(note.id)}`);
}

async function makeNew(): Promise<void> {
  if (notes.creating.value) return;

  try {
    const id = await notes.create();

    await router.push(`/note/${encodeURIComponent(id)}`);
  } catch {
    // A note that could not be started says so; the screen stands where it was, ready to try again.
    toast.add({ title: i18n.t("note.error.create_failed"), color: "error" });
  }
}

async function retry(): Promise<void> {
  if (retrying.value) return;

  retrying.value = true;

  try {
    await notes.load();
  } finally {
    retrying.value = false;
  }
}

function askDelete(note: NoteMeta): void {
  confirming.value = note.id;
}

function cancelDelete(): void {
  confirming.value = null;
}

async function confirmDelete(): Promise<void> {
  if (confirming.value === null || working.value !== null) return;

  const id = confirming.value;

  working.value = id;

  try {
    await notes.trash(id);
    confirming.value = null;
  } catch {
    toast.add({ title: i18n.t("note.error.action_failed"), color: "error" });
  } finally {
    working.value = null;
  }
}

async function restore(note: NoteMeta): Promise<void> {
  if (working.value !== null) return;

  working.value = note.id;

  try {
    await notes.restore(note.id, note.version);
  } catch {
    toast.add({ title: i18n.t("note.error.action_failed"), color: "error" });
  } finally {
    working.value = null;
  }
}

async function purge(note: NoteMeta): Promise<void> {
  if (working.value !== null) return;

  working.value = note.id;

  try {
    await notes.purge(note.id);
  } catch {
    toast.add({ title: i18n.t("note.error.action_failed"), color: "error" });
  } finally {
    working.value = null;
  }
}

function changedText(note: NoteMeta): string {
  const moment = new Intl.DateTimeFormat(i18n.locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return moment.format(note.deletedAt ?? note.changedAt);
}

function titleText(note: NoteMeta): string {
  return note.title === "" ? i18n.t("note.label.untitled") : note.title;
}

// The second line of a row: what the note holds, then when it changed; a trashed row names its moment
// as the one it went to the trash, not as an edit.
function detailText(note: NoteMeta): string {
  const size = sizeOf(note.size, i18n.locale.value);

  return live.value ? `${size} · ${changedText(note)}` : `${size} · ${i18n.t("note.label.trashed")} ${changedText(note)}`;
}
</script>

<template>
  <!-- The list stands in the console's content width, as every console screen does (docs/web.md,
       「Layout fundamentals」); the page's ground fills the panel the width stands in. -->
  <div class="flex h-full min-h-0 flex-col">
    <header class="shrink-0 border-b border-default px-4 sm:px-6">
      <div class="mx-auto flex w-full max-w-(--ui-container) flex-col gap-2 py-3">
        <!-- Where the console draws no bar, the screen names itself before the row of actions. -->
        <h1 v-if="consoleBar === null" class="text-xl font-semibold text-highlighted">{{ $t("note.title") }}</h1>

        <div class="flex items-center gap-2">
          <UTabs
            :items="[
              { label: $t('note.view.live'), value: 'live' },
              { label: $t('note.view.trash'), value: 'trash' }
            ]"
            :model-value="notes.view.value"
            :content="false"
            color="neutral"
            class="shrink-0"
            @update:model-value="notes.switchView($event as 'live' | 'trash')"
          />
          <UButton
            icon="i-material-symbols-add"
            :label="$t('note.action.new')"
            :loading="notes.creating.value"
            :aria-label="$t('note.action.new')"
            class="ms-auto"
            @click="makeNew"
          />
        </div>
      </div>
    </header>

    <main ref="list" class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
      <div class="mx-auto flex w-full max-w-(--ui-container) flex-col py-2">
        <!-- A first fetch reserves the row it will replace: an icon and the two lines of the row. -->
        <div v-if="notes.stand.value === 'loading' && notes.rows.value.length === 0" role="status" :aria-label="$t('note.status.loading')" class="flex flex-col gap-1">
          <div v-for="row in 5" :key="row" class="flex items-center gap-3 px-3 py-2.5">
            <USkeleton class="size-5 shrink-0 rounded-sm" />
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <USkeleton class="h-4 w-2/5 rounded-sm" />
              <USkeleton class="h-3 w-1/4 rounded-sm" />
            </div>
          </div>
        </div>

        <div v-else-if="notes.stand.value === 'failed' && notes.rows.value.length === 0" role="alert" class="flex flex-col items-center gap-3 py-20 text-center">
          <UIcon name="i-material-symbols-error-outline" class="size-10 text-error" />
          <p class="text-sm text-error">{{ $t("note.error.list_failed") }}</p>
          <UButton size="sm" color="neutral" variant="soft" icon="i-material-symbols-refresh" :loading="retrying" :label="$t('note.action.retry')" @click="retry" />
        </div>

        <div v-else-if="notes.rows.value.length === 0" class="flex flex-col items-center gap-3 py-20 text-center">
          <UIcon :name="live ? 'i-material-symbols-edit-note-outline' : 'i-material-symbols-delete-outline'" class="size-10 text-dimmed" />
          <p class="text-sm text-muted">{{ live ? $t("note.empty.live") : $t("note.empty.trash") }}</p>
          <UButton v-if="live" icon="i-material-symbols-add" :label="$t('note.action.new')" :loading="notes.creating.value" @click="makeNew" />
        </div>

        <template v-else>
          <!-- A re-read that did not answer keeps the rows that stand and says so above them. -->
          <p v-if="notes.stand.value === 'failed'" role="alert" class="mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-error">
            <UIcon name="i-material-symbols-error-outline" class="size-4 shrink-0" />
            <span class="min-w-0 flex-1">{{ $t("note.error.list_failed") }}</span>
            <UButton size="xs" color="neutral" variant="subtle" icon="i-material-symbols-refresh" :loading="retrying" :label="$t('note.action.retry')" @click="retry" />
          </p>

          <ul class="flex flex-col gap-1">
            <li v-for="note in notes.rows.value" :key="note.id" :data-note="note.id">
              <!-- The row: the title takes the room; what it holds and when it changed stand under it.
                   A row the reader has just come back from wears the chosen tone for a breath. -->
              <div
                v-if="confirming !== note.id"
                class="flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-elevated active:bg-accented"
                :class="justRead === note.id ? 'bg-elevated' : ''"
              >
                <component
                  :is="live ? 'button' : 'div'"
                  :type="live ? 'button' : undefined"
                  class="flex min-w-0 flex-1 items-center gap-3 py-0.5 text-start focus-inset"
                  @click="open(note)"
                >
                  <UIcon :name="live ? 'i-material-symbols-description-outline' : 'i-material-symbols-delete-outline'" class="size-5 shrink-0 text-dimmed" />
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <HintTip
                      :text="titleText(note)"
                      cut
                      press
                      class="block min-w-0 truncate text-base"
                      :class="note.title === '' ? 'text-dimmed' : 'text-highlighted'"
                    >
                      {{ titleText(note) }}
                    </HintTip>
                    <HintTip :text="detailText(note)" cut press class="block min-w-0 truncate text-sm tabular-nums text-muted">
                      {{ detailText(note) }}
                    </HintTip>
                  </span>
                </component>

                <HintTip v-if="live" :text="$t('note.action.delete')" press>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    square
                    icon="i-material-symbols-delete-outline"
                    :aria-label="$t('note.action.delete')"
                    @click="askDelete(note)"
                  />
                </HintTip>
                <template v-else>
                  <HintTip :text="$t('note.action.restore')" press>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      square
                      icon="i-material-symbols-settings-backup-restore"
                      :loading="working === note.id"
                      :disabled="working !== null"
                      :aria-label="$t('note.action.restore')"
                      @click="restore(note)"
                    />
                  </HintTip>
                  <HintTip :text="$t('note.action.purge')" press>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="sm"
                      square
                      icon="i-material-symbols-delete-forever-outline"
                      class="text-error"
                      :loading="working === note.id"
                      :disabled="working !== null"
                      :aria-label="$t('note.action.purge')"
                      @click="askDelete(note)"
                    />
                  </HintTip>
                </template>
              </div>

              <!-- A destructive step grows its own row: the question stands where the item stands. -->
              <div v-else class="flex min-h-[4.25rem] items-center gap-2 rounded-lg bg-elevated px-3" data-confirm>
                <span class="min-w-0 flex-1 truncate text-sm">
                  {{ live ? $t("note.question.delete") : $t("note.question.purge") }}
                  <span v-if="!live" class="text-dimmed">{{ $t("note.question.purge_effect") }}</span>
                </span>
                <UButton color="neutral" variant="ghost" size="sm" @click="cancelDelete">{{ $t("note.action.cancel") }}</UButton>
                <UButton
                  :color="live ? 'neutral' : 'error'"
                  :variant="live ? 'solid' : 'subtle'"
                  size="sm"
                  :loading="working === note.id"
                  @click="live ? confirmDelete() : purge(note)"
                >
                  {{ live ? $t("note.action.delete") : $t("note.action.purge") }}
                </UButton>
              </div>
            </li>
          </ul>

          <div v-if="notes.more.value && notes.stand.value === 'ready'" class="flex justify-center py-4">
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              :loading="notes.appending.value"
              :label="$t('note.action.more')"
              @click="notes.append()"
            />
          </div>
        </template>
      </div>
    </main>
  </div>
</template>
