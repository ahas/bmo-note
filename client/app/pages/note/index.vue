<script setup lang="ts">
// The notes list: the account's own, newest changed first, with the trash kept a view away. A row
// opens its note; its actions stand at its right (`docs/design.md`, 「The console surface」).

import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useToast } from "@nuxt/ui/composables/useToast";
import HintTip from "bmo-ui/app/components/HintTip.vue";

import { useNotes } from "../../composables/useNotes";

import type { NoteMeta } from "../../../shared/types";

const i18n = useI18n();
const router = useRouter();
const notes = useNotes();
const toast = useToast();

const opening = ref<string | null>(null);
const confirming = ref<string | null>(null);

onMounted(() => void notes.load());

function open(note: NoteMeta): void {
  if (notes.view.value !== "live") return;

  void router.push(`/note/${encodeURIComponent(note.id)}`);
}

async function makeNew(): Promise<void> {
  if (notes.creating.value) return;

  opening.value = "new";

  try {
    const id = await notes.create();

    await router.push(`/note/${encodeURIComponent(id)}`);
  } catch {
    // A note that could not be started says so; the screen stands where it was, ready to try again.
    toast.add({ title: i18n.t("note.error.create_failed"), color: "error" });
    opening.value = null;
  }
}

function askDelete(note: NoteMeta): void {
  confirming.value = note.id;
}

function cancelDelete(): void {
  confirming.value = null;
}

async function confirmDelete(): Promise<void> {
  if (confirming.value === null) return;

  await notes.trash(confirming.value);
  confirming.value = null;
}

async function restore(note: NoteMeta): Promise<void> {
  await notes.restore(note.id, note.version);
}

async function purge(note: NoteMeta): Promise<void> {
  await notes.purge(note.id);
}

function changedText(note: NoteMeta): string {
  const moment = new Intl.DateTimeFormat(i18n.locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return moment.format(note.deletedAt ?? note.changedAt);
}

function titleText(note: NoteMeta): string {
  return note.title === "" ? i18n.t("note.label.untitled") : note.title;
}
</script>

<template>
  <!-- The list stands in the console's content width, as every console screen does (docs/web.md,
       「Layout fundamentals」); the page's ground fills the panel the width stands in. -->
  <div class="flex h-full min-h-0 flex-col">
    <div class="mx-auto flex h-12 w-full max-w-(--ui-container) shrink-0 items-center justify-between gap-2 px-4">
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

    <main class="mx-auto min-h-0 w-full max-w-(--ui-container) flex-1 overflow-y-auto px-4 pb-4">
      <div v-if="notes.stand.value === 'loading'" role="status" :aria-label="$t('note.status.loading')" class="flex flex-col gap-2 py-2">
        <USkeleton v-for="row in 5" :key="row" class="h-14 w-full rounded-lg" />
      </div>

      <p v-else-if="notes.stand.value === 'failed'" role="alert" class="flex items-center gap-3 py-8 text-sm text-error">
        {{ $t("note.error.list_failed") }}
        <UButton size="xs" color="neutral" variant="soft" icon="i-material-symbols-refresh" @click="notes.refresh()">
          {{ $t("note.action.retry") }}
        </UButton>
      </p>

      <div v-else-if="notes.rows.value.length === 0" class="flex flex-col items-center gap-3 py-16 text-center">
        <UIcon name="i-material-symbols-edit-note-outline" class="size-10 text-dimmed" />
        <p class="text-sm text-muted">{{ notes.view.value === "live" ? $t("note.empty.live") : $t("note.empty.trash") }}</p>
        <UButton v-if="notes.view.value === 'live'" icon="i-material-symbols-add" :label="$t('note.action.new')" :loading="notes.creating.value" @click="makeNew" />
      </div>

      <ul v-else class="flex flex-col gap-1">
        <li v-for="note in notes.rows.value" :key="note.id">
          <!-- The row: title takes the room, the moment and the actions keep their own. -->
          <div v-if="confirming !== note.id" class="flex min-h-12 items-center gap-2 rounded-lg px-3 transition-colors hover:bg-elevated active:bg-accented">
            <component
              :is="notes.view.value === 'live' ? 'button' : 'div'"
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 py-2 text-start focus-inset"
              @click="open(note)"
            >
              <UIcon :name="notes.view.value === 'live' ? 'i-material-symbols-description-outline' : 'i-material-symbols-delete-outline'" class="size-5 shrink-0 text-dimmed" />
              <span class="min-w-0 flex-1 truncate text-base" :class="note.title === '' ? 'text-dimmed' : ''">{{ titleText(note) }}</span>
              <span class="shrink-0 text-sm tabular-nums text-muted">{{ changedText(note) }}</span>
            </component>

            <HintTip v-if="notes.view.value === 'live'" :text="$t('note.action.delete')" press>
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
                  icon="i-material-symbols-restore"
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
                  :aria-label="$t('note.action.purge')"
                  @click="askDelete(note)"
                />
              </HintTip>
            </template>
          </div>

          <!-- A destructive step grows its own row: the question stands where the item stands. -->
          <div v-else class="flex min-h-12 items-center gap-2 rounded-lg bg-elevated px-3" data-confirm>
            <span class="min-w-0 flex-1 truncate text-sm">
              {{ notes.view.value === "live" ? $t("note.question.delete") : $t("note.question.purge") }}
              <span v-if="notes.view.value === 'trash'" class="text-dimmed">{{ $t("note.question.purge_effect") }}</span>
            </span>
            <UButton color="neutral" variant="ghost" size="sm" @click="cancelDelete">{{ $t("note.action.cancel") }}</UButton>
            <UButton
              :color="notes.view.value === 'live' ? 'neutral' : 'error'"
              :variant="notes.view.value === 'live' ? 'solid' : 'subtle'"
              size="sm"
              @click="notes.view.value === 'live' ? confirmDelete() : purge(note)"
            >
              {{ notes.view.value === "live" ? $t("note.action.delete") : $t("note.action.purge") }}
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
    </main>
  </div>
</template>
