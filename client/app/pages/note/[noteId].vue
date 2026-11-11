<script setup lang="ts">
// One note open: the note's own head, the format bar and the BlockSuite page editor in one column,
// autosaved with a short debounce, its state and holding told in the status line at the screen's
// foot, and what must be acted on said in a banner above the document (`docs/design.md`, 「Editing
// and saving」, 「The console surface」). The head carries the way back and the note's title; it rides
// the console's title bar where the console offers one, and stands as the screen's own where it does
// not. The talk key stands at the format bar's trailing edge, and its panel is docked beside the
// document.

import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import { askQuestion } from "bmo-ui/app/domain/question";
import { relayCall } from "bmo-ui/app/domain/relay";

import NoteEditor from "../../components/NoteEditor.vue";
import NoteTalk from "../../components/NoteTalk.vue";
import { createNoteApi, Refusal, Unreachable } from "../../domain/api";
import { clockOf, sizeOf } from "../../domain/count";
import { holdsChange, initialSaveState, nextSaveState, versionOf } from "../../domain/save";

import type { RelayOptions } from "bmo-ui/app/domain/relay";
import type { Call } from "../../domain/api";
import type { Holding } from "../../domain/count";
import type { Note } from "../../../shared/types";
import type { ReplaceResult } from "../../domain/apply";
import type { Op } from "../../domain/patch";
import type { SaveState } from "../../domain/save";

const SERVICE = "note";

const i18n = useI18n();
const router = useRouter();
const api = createNoteApi(<T>(path: string, options?: Parameters<Call>[1]) => relayCall<T>(SERVICE, path, options as RelayOptions));

// The console's bar, where it offers one: the place after its name the screen's own actions take, and the place
// before it the way back takes where the console names one.
const barOffer = inject<{ screenActions: string; screenLead?: string } | null>("bmo-console-title-bar", null);

const noteId = String(router.currentRoute.value.params.noteId ?? "");
const note = shallowRef<Note | null>(null);
const stand = ref<"loading" | "ready" | "missing" | "failed">("loading");
const readCount = ref(0);
const saveState = ref<SaveState>(initialSaveState({ id: noteId, title: "", version: 1, createdAt: 0, changedAt: 0, size: 0, deletedAt: null }));
const editor = shallowRef<InstanceType<typeof NoteEditor> | null>(null);
const holding = ref<Holding>({ words: 0 });
const talkOpen = ref(false);
const liveTitle = ref("");
const retrying = ref(false);
const reloading = ref(false);

let debounce: ReturnType<typeof setTimeout> | null = null;
let unloadGuard: ((event: BeforeUnloadEvent) => void) | null = null;

const changed = computed(() => holdsChange(saveState.value));

async function read(): Promise<void> {
  stand.value = "loading";

  try {
    const found = await api.read(noteId);

    note.value = found;
    saveState.value = initialSaveState(found);
    liveTitle.value = found.title;
    holding.value = { words: 0 };
    readCount.value += 1;
    stand.value = "ready";
  } catch (error) {
    stand.value = error instanceof Refusal && error.status === 404 ? "missing" : "failed";
  }
}

onMounted(() => {
  void read();

  unloadGuard = (event: BeforeUnloadEvent) => {
    if (changed.value) event.preventDefault();
  };

  addEventListener("beforeunload", unloadGuard);
  addEventListener("keydown", saveKey, true);
});

// Ctrl+S (⌘S) saves at once in place of the browser's own save. It is caught on the way down, before the
// editor sees the key, so it holds wherever the focus stands on the screen.
function saveKey(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "s") return;

  event.preventDefault();
  event.stopPropagation();

  if (debounce !== null) {
    clearTimeout(debounce);
    debounce = null;
  }

  void flush();
}

onBeforeUnmount(() => {
  if (unloadGuard !== null) removeEventListener("beforeunload", unloadGuard);

  removeEventListener("keydown", saveKey, true);

  if (debounce !== null) clearTimeout(debounce);
});

function onEdit(): void {
  saveState.value = nextSaveState(saveState.value, { type: "edited" });
  count();

  if (debounce !== null) clearTimeout(debounce);

  debounce = setTimeout(() => {
    debounce = null;
    void flush();
  }, 800);
}

/** The foot line's count, read from the document the editor holds. */
function count(): void {
  const exposed = editor.value as { holding?: () => Holding } | null;

  holding.value = exposed?.holding?.() ?? holding.value;
}

function snapshot(): { doc: string; title: string } | null {
  const exposed = editor.value as { snapshot?: () => { doc: string; title: string } } | null;

  return exposed?.snapshot?.() ?? null;
}

/** The note's title as the open document holds it, which the head and the talk name it by. */
function readTitle(): void {
  liveTitle.value = snapshot()?.title ?? note.value?.title ?? "";
}

const titleLine = computed(() => {
  const title = liveTitle.value.trim();

  return title === "" ? i18n.t("note.label.untitled") : title;
});

// Before the document is read there is no note title to name, so the head names the screen.
const headTitle = computed(() => (stand.value === "ready" ? titleLine.value : i18n.t("note.title")));

function talkLines(): string[] {
  return editor.value?.lines() ?? [];
}

function talkApply(ops: Op[]): boolean {
  return editor.value?.apply(ops) ?? false;
}

function talkReplace(lines: string[]): ReplaceResult {
  return editor.value?.replace(lines) ?? { ok: false, kinds: [] };
}

function talkRename(title: string): boolean {
  return editor.value?.rename(title) ?? false;
}

/** Sends what the editor holds, naming the version it was made from (`docs/api.md`, 「Notes」). */
async function flush(): Promise<void> {
  const held = note.value;

  if (held === null || !holdsChange(saveState.value)) return;

  const before = saveState.value;

  saveState.value = nextSaveState(before, { type: "flush" });

  if (saveState.value === before) return;

  const taken = snapshot();

  try {
    const meta = await api.save(held.id, {
      version: versionOf(saveState.value) ?? held.version,
      title: taken?.title,
      doc: taken?.doc
    });

    note.value = { ...held, ...meta, doc: held.doc };
    saveState.value = nextSaveState(saveState.value, { type: "answered", meta });
  } catch (error) {
    if (error instanceof Refusal && error.status === 409 && error.note !== undefined) {
      saveState.value = nextSaveState(saveState.value, { type: "conflict", note: error.note });
    } else if (error instanceof Unreachable) {
      saveState.value = nextSaveState(saveState.value, { type: "unreachable" });
    } else {
      const code = error instanceof Refusal ? error.code : "failed";

      saveState.value = nextSaveState(saveState.value, { type: "refused", code });
    }
  }
}

async function retrySave(): Promise<void> {
  if (saveState.value.kind === "conflict" || retrying.value) return;

  retrying.value = true;
  saveState.value = nextSaveState(saveState.value, { type: "edited" });

  try {
    await flush();
  } finally {
    retrying.value = false;
  }
}

async function reloadNote(): Promise<void> {
  if (reloading.value) return;

  reloading.value = true;

  if (debounce !== null) clearTimeout(debounce);

  try {
    await read();
  } finally {
    reloading.value = false;
  }
}

// Leaving with a change unsent: the save goes first; where it cannot land, the reader is asked.
onBeforeRouteLeave(async () => {
  if (!changed.value) return true;

  await flush();

  if (!changed.value) return true;

  return askQuestion({
    title: i18n.t("note.question.leave"),
    effect: i18n.t("note.question.leave_effect"),
    confirm: i18n.t("note.action.leave"),
    leaving: true
  });
});

// The save state as the head and the status line say it: the state's own icon, tone and word.
const saveLabel = computed(() => {
  switch (saveState.value.kind) {
    case "queued":
    case "saving":
      return i18n.t("note.label.saving");
    case "saved":
      return i18n.t("note.label.saved");
    case "conflict":
      return i18n.t("note.label.conflict");
    default:
      return i18n.t("note.label.save_failed");
  }
});

const saveIcon = computed(() => {
  switch (saveState.value.kind) {
    case "queued":
    case "saving":
      return "i-material-symbols-progress-activity";
    case "saved":
      return "i-material-symbols-check-circle-outline";
    case "conflict":
      return "i-material-symbols-warning-outline";
    case "offline":
      return "i-material-symbols-cloud-off-outline";
    default:
      return "i-material-symbols-error-outline";
  }
});

const saveTone = computed(() => {
  switch (saveState.value.kind) {
    case "conflict":
      return "text-warning";
    case "offline":
    case "refused":
      return "text-error";
    default:
      return "text-muted";
  }
});

const saveSpin = computed(() => saveState.value.kind === "queued" || saveState.value.kind === "saving");

// The status line: what the note holds, and the save state with the moment the last save landed.
const wordsLine = computed(() => `${new Intl.NumberFormat(i18n.locale.value).format(holding.value.words)} ${i18n.t("note.label.words")}`);

const sizeLine = computed(() => sizeOf(note.value?.size ?? 0, i18n.locale.value));

const footState = computed(() => {
  if (saveState.value.kind !== "saved") return saveLabel.value;

  return `${i18n.t("note.label.saved")} ${clockOf(note.value?.changedAt ?? Date.now(), i18n.locale.value)}`;
});

// The refused save's line names its code where the pack has one: the document too large is told
// apart from a plain refusal.
const refusedLine = computed(() => {
  if (saveState.value.kind !== "refused") return i18n.t("note.status.offline");

  const key = `note.error.${saveState.value.code}`;

  return i18n.te(key) ? i18n.t(key) : i18n.t("note.status.refused");
});

async function goBack(): Promise<void> {
  await router.push("/note");
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- The head, riding the console's title bar where it offers one: the way back before the screen's name, the
         note's title after it — or both after it, the way back first, where the bar offers no place before.
         Where it offers no bar, the screen stands the same row itself. -->
    <Teleport v-if="barOffer?.screenLead && note !== null && stand === 'ready'" defer :to="barOffer.screenLead">
      <HintTip :text="$t('note.action.back')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-arrow-back" :aria-label="$t('note.action.back')" @click="goBack" />
      </HintTip>
    </Teleport>

    <Teleport v-if="barOffer !== null && note !== null && stand === 'ready'" defer :to="barOffer.screenActions">
      <div class="flex min-w-0 items-center gap-2">
        <HintTip v-if="!barOffer.screenLead" :text="$t('note.action.back')" press>
          <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-arrow-back" :aria-label="$t('note.action.back')" @click="goBack" />
        </HintTip>

        <HintTip class="hidden max-w-64 min-w-0 truncate text-sm font-medium text-highlighted sm:block" style="align-self: center" :text="titleLine" cut>{{ titleLine }}</HintTip>
      </div>
    </Teleport>

    <div v-if="barOffer === null" class="flex h-12 shrink-0 items-center gap-2 border-b border-default px-4 sm:px-6">
      <HintTip :text="$t('note.action.back')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-arrow-back" :aria-label="$t('note.action.back')" @click="goBack" />
      </HintTip>
      <HintTip class="block min-w-0 truncate text-sm font-medium text-highlighted" style="align-self: center" :text="headTitle" cut>{{ headTitle }}</HintTip>

    </div>

    <div class="flex min-h-0 flex-1" data-screen-fill>
      <div class="flex min-w-0 flex-1 flex-col">
        <div v-if="stand === 'loading'" role="status" :aria-label="$t('note.status.loading')" class="flex w-full flex-col gap-4 px-4 py-6 sm:px-6">
          <USkeleton class="h-9 w-2/5 rounded-md" />
          <div class="flex flex-col gap-2">
            <USkeleton class="h-4 w-full rounded-sm" />
            <USkeleton class="h-4 w-3/4 rounded-sm" />
            <USkeleton class="h-4 w-full rounded-sm" />
          </div>
        </div>

        <div v-else-if="stand === 'missing'" class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
          <UIcon name="i-material-symbols-search-off" class="size-10 text-dimmed" />
          <p class="text-sm text-muted">{{ $t("note.status.missing") }}</p>
          <UButton color="neutral" variant="soft" icon="i-material-symbols-arrow-back" :label="$t('note.action.back')" @click="goBack" />
        </div>

        <div v-else-if="stand === 'failed'" role="alert" class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
          <UIcon name="i-material-symbols-error-outline" class="size-10 text-error" />
          <p class="text-sm text-error">{{ $t("note.error.read_failed") }}</p>
          <UButton color="neutral" variant="soft" icon="i-material-symbols-refresh" :label="$t('note.action.retry')" @click="read" />
        </div>

        <template v-else-if="note !== null">
          <!-- What the reader must act on stands in a line of its own, above the document. -->
          <div v-if="saveState.kind === 'conflict'" class="flex min-h-11 shrink-0 items-center gap-3 border-b border-default bg-warning/10 px-4 text-sm sm:px-6" role="alert">
            <UIcon name="i-material-symbols-warning-outline" class="size-5 shrink-0 text-warning" />
            <span class="min-w-0 flex-1">{{ $t("note.status.conflict") }}</span>
            <UButton size="xs" color="neutral" variant="subtle" icon="i-material-symbols-refresh" :loading="reloading" @click="reloadNote">{{ $t("note.action.reload") }}</UButton>
          </div>
          <div v-else-if="saveState.kind === 'offline' || saveState.kind === 'refused'" class="flex min-h-11 shrink-0 items-center gap-3 border-b border-default bg-error/10 px-4 text-sm text-error sm:px-6" role="alert">
            <UIcon :name="saveState.kind === 'offline' ? 'i-material-symbols-cloud-off-outline' : 'i-material-symbols-error-outline'" class="size-5 shrink-0" />
            <span class="min-w-0 flex-1">{{ refusedLine }}</span>
            <UButton size="xs" color="neutral" variant="subtle" icon="i-material-symbols-refresh" :loading="retrying" @click="retrySave">{{ $t("note.action.retry") }}</UButton>
          </div>

          <NoteEditor
            :key="`${note.id}-${readCount}`"
            :ref="(mount) => { editor = mount as InstanceType<typeof NoteEditor> | null }"
            :note-id="note.id"
            :doc="note.doc"
            :title="titleLine"
            @change="onEdit"
            @title="liveTitle = $event"
            @ready="() => { count(); readTitle(); }"
          >
            <template #barEnd>
              <HintTip :text="$t('note.action.talk')" press>
                <UButton size="lg" color="neutral" variant="ghost" icon="i-material-symbols-forum-outline" class="pointer-coarse:h-10" :label="$t('note.action.talk')" @click="talkOpen = true" />
              </HintTip>
            </template>
          </NoteEditor>

          <div class="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-default px-4 text-sm tabular-nums sm:px-6" data-screen-foot>
            <span class="flex min-w-0 items-center gap-1.5 text-muted">
              <UIcon name="i-material-symbols-notes" class="size-4 shrink-0" />
              <span class="truncate">{{ wordsLine }}</span>
              <span class="text-dimmed">·</span>
              <span class="truncate">{{ sizeLine }}</span>
            </span>
            <span role="status" aria-live="polite" class="inline-flex min-w-0 items-center gap-1.5" :class="saveTone">
              <UIcon :name="saveIcon" class="size-4 shrink-0" :class="saveSpin ? 'animate-spin' : ''" />
              <span class="truncate">{{ footState }}</span>
            </span>
          </div>
        </template>
      </div>

      <NoteTalk
        v-if="stand === 'ready' && note !== null"
        v-model:open="talkOpen"
        :note-id="note.id"
        :title="titleLine"
        :lines="talkLines"
        :apply="talkApply"
        :replace="talkReplace"
        :rename="talkRename"
      />
    </div>
  </div>
</template>
