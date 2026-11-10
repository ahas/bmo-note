<script setup lang="ts">
// One note open: the format bar and the BlockSuite page editor on the document the service holds,
// autosaved with a short debounce, its state and holding told in the line at the screen's foot, and
// what must be acted on said in a banner above the document (`docs/design.md`, 「Editing and saving」,
// 「The console surface」). The way back to the list rides the console's title bar where the console
// offers one, and stands at the screen's own head where it does not.

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
import type { Op } from "../../domain/patch";
import type { SaveState } from "../../domain/save";

const SERVICE = "note";

const i18n = useI18n();
const router = useRouter();
const api = createNoteApi(<T>(path: string, options?: Parameters<Call>[1]) => relayCall<T>(SERVICE, path, options as RelayOptions));

// The console's bar, where it offers one: the place its name line takes the screen's own actions.
const barOffer = inject<{ screenActions: string } | null>("bmo-console-title-bar", null);

const noteId = String(router.currentRoute.value.params.noteId ?? "");
const note = shallowRef<Note | null>(null);
const stand = ref<"loading" | "ready" | "missing" | "failed">("loading");
const readCount = ref(0);
const saveState = ref<SaveState>(initialSaveState({ id: noteId, title: "", version: 1, createdAt: 0, changedAt: 0, size: 0, deletedAt: null }));
const editor = shallowRef<InstanceType<typeof NoteEditor> | null>(null);
const holding = ref<Holding>({ words: 0 });
const talkOpen = ref(false);

let debounce: ReturnType<typeof setTimeout> | null = null;
let unloadGuard: ((event: BeforeUnloadEvent) => void) | null = null;

const changed = computed(() => holdsChange(saveState.value));

async function read(): Promise<void> {
  stand.value = "loading";

  try {
    const found = await api.read(noteId);

    note.value = found;
    saveState.value = initialSaveState(found);
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
});

onBeforeUnmount(() => {
  if (unloadGuard !== null) removeEventListener("beforeunload", unloadGuard);

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

/** The title the talk opens on, as the list and the service name it. */
const talkTitle = computed(() => {
  const title = note.value?.title ?? "";

  return title === "" ? i18n.t("note.label.untitled") : title;
});

function talkLines(): string[] {
  return editor.value?.lines() ?? [];
}

function talkApply(ops: Op[]): boolean {
  return editor.value?.apply(ops) ?? false;
}

function talkReplace(lines: string[]): boolean {
  return editor.value?.replace(lines) ?? false;
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
  if (saveState.value.kind === "conflict") return;

  saveState.value = nextSaveState(saveState.value, { type: "edited" });
  await flush();
}

async function reloadNote(): Promise<void> {
  if (debounce !== null) clearTimeout(debounce);

  await read();
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

const stateLine = computed(() => {
  switch (saveState.value.kind) {
    case "queued":
    case "saving":
      return i18n.t("note.label.saving");
    case "saved":
      return i18n.t("note.label.saved");
    default:
      return null;
  }
});

// The refused save's line names its code where the pack has one: the document too large is told
// apart from a plain refusal.
const refusedLine = computed(() => {
  if (saveState.value.kind !== "refused") return i18n.t("note.status.offline");

  const key = `note.error.${saveState.value.code}`;

  return i18n.te(key) ? i18n.t(key) : i18n.t("note.status.refused");
});

// The foot line: what the note holds, beside the save state and the moment the last save landed.
const wordsLine = computed(() => `${new Intl.NumberFormat(i18n.locale.value).format(holding.value.words)} ${i18n.t("note.label.words")}`);

const sizeLine = computed(() => sizeOf(note.value?.size ?? 0, i18n.locale.value));

// Once the last save landed, the standing line says when; while one is out or held back, the plain
// state word stands.
const savedLine = computed(() => {
  if (saveState.value.kind !== "saved") return stateLine.value;

  return `${i18n.t("note.label.saved")} ${clockOf(note.value?.changedAt ?? Date.now(), i18n.locale.value)}`;
});

async function goBack(): Promise<void> {
  await router.push("/note");
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- The way back to the list: beside the console's name where the console offers its bar, at this
         screen's own head where it does not. The browser's and the gesture's back stand untouched. -->
    <Teleport v-if="barOffer !== null && note !== null" defer :to="barOffer.screenActions">
      <HintTip class="flex" :text="$t('note.action.talk')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-forum-outline" :aria-label="$t('note.action.talk')" @click="talkOpen = true" />
      </HintTip>
      <HintTip class="flex" :text="$t('note.action.back')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-arrow-back" :aria-label="$t('note.action.back')" @click="goBack" />
      </HintTip>
    </Teleport>

    <div v-if="barOffer === null && note !== null && stand === 'ready'" class="flex h-11 shrink-0 items-center gap-2 px-4">
      <HintTip :text="$t('note.action.talk')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-forum-outline" :aria-label="$t('note.action.talk')" @click="talkOpen = true" />
      </HintTip>
      <HintTip :text="$t('note.action.back')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-arrow-back" :aria-label="$t('note.action.back')" data-back @click="goBack" />
      </HintTip>
    </div>

    <div class="mx-auto flex min-h-0 w-full max-w-(--ui-container) flex-1 flex-col">
      <div v-if="stand === 'loading'" role="status" :aria-label="$t('note.status.loading')" class="flex w-full flex-col gap-3 p-4">
        <USkeleton class="h-8 w-64 rounded-md" />
        <USkeleton class="h-4 w-full max-w-2xl rounded-sm" />
        <USkeleton class="h-4 w-3/4 max-w-xl rounded-sm" />
        <USkeleton class="h-4 w-full max-w-2xl rounded-sm" />
      </div>

      <div v-else-if="stand === 'missing'" class="flex flex-col items-center gap-3 py-16 text-center">
        <UIcon name="i-material-symbols-search-off-outline" class="size-10 text-dimmed" />
        <p class="text-sm text-muted">{{ $t("note.status.missing") }}</p>
        <UButton color="neutral" variant="soft" icon="i-material-symbols-arrow-back" :label="$t('note.action.back')" @click="goBack" />
      </div>

      <div v-else-if="stand === 'failed'" class="flex flex-col items-center gap-3 py-16 text-center" role="alert">
        <p class="text-sm text-error">{{ $t("note.error.read_failed") }}</p>
        <UButton color="neutral" variant="soft" icon="i-material-symbols-refresh" :label="$t('note.action.retry')" @click="read" />
      </div>

      <template v-else-if="note !== null">
        <!-- What the reader must act on stands in a line of its own, above the document. -->
        <div v-if="saveState.kind === 'conflict'" class="flex min-h-11 shrink-0 items-center gap-3 border-b border-default bg-warning/10 px-4 text-sm" role="alert">
          <span class="min-w-0 flex-1 truncate">{{ $t("note.status.conflict") }}</span>
          <UButton size="xs" color="neutral" variant="subtle" icon="i-material-symbols-refresh" @click="reloadNote">{{ $t("note.action.reload") }}</UButton>
        </div>
        <div v-else-if="saveState.kind === 'offline' || saveState.kind === 'refused'" class="flex min-h-11 shrink-0 items-center gap-3 border-b border-default bg-error/10 px-4 text-sm text-error" role="alert">
          <span class="min-w-0 flex-1 truncate">{{ refusedLine }}</span>
          <UButton size="xs" color="neutral" variant="subtle" icon="i-material-symbols-refresh" @click="retrySave">{{ $t("note.action.retry") }}</UButton>
        </div>

        <NoteEditor :key="`${note.id}-${readCount}`" :ref="(mount) => { editor = mount as InstanceType<typeof NoteEditor> | null }" :note-id="note.id" :doc="note.doc" @change="onEdit" @ready="count" />

        <div class="flex h-8 shrink-0 items-center justify-between gap-3 px-4 text-sm tabular-nums text-dimmed" data-screen-foot>
          <span>{{ wordsLine }} · {{ sizeLine }}</span>
          <span v-if="savedLine !== null">{{ savedLine }}</span>
        </div>

        <NoteTalk v-model:open="talkOpen" :note-id="note.id" :title="talkTitle" :lines="talkLines" :apply="talkApply" :replace="talkReplace" />
      </template>
    </div>
  </div>
</template>
