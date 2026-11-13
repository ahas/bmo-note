<script setup lang="ts">
// The note a link opens, to whoever holds the link, with no sign-in and no frame of the console's: its
// own bar holding the note's title, and the document read only under it, its images read through the
// link (`docs/design.md`, 「Sharing on the screens」). Every call is a share read the manifest names.

import { computed, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import { relayCall } from "bmo-ui/app/domain/relay";

import NoteEditor from "../../../components/NoteEditor.vue";
import { createNoteApi, Refusal } from "../../../domain/api";
import { sharedBlobSource } from "../../../domain/blobs";

import type { RelayOptions } from "bmo-ui/app/domain/relay";
import type { Call } from "../../../domain/api";
import type { SharedNote } from "../../../../shared/types";

const SERVICE = "note";

const i18n = useI18n();
const route = useRoute();
const api = createNoteApi(<T>(path: string, options?: Parameters<Call>[1]) => relayCall<T>(SERVICE, path, options as RelayOptions));

const token = String(route.params.token ?? "");
const blobs = sharedBlobSource(token);
const note = shallowRef<SharedNote | null>(null);
const stand = ref<"loading" | "ready" | "missing" | "failed">("loading");

const titleLine = computed(() => {
  const title = note.value?.title.trim() ?? "";

  return title === "" ? i18n.t("note.label.untitled") : title;
});

async function read(): Promise<void> {
  stand.value = "loading";

  try {
    note.value = await api.shared(token);
    stand.value = "ready";
  } catch (error) {
    stand.value = error instanceof Refusal && error.status === 404 ? "missing" : "failed";
  }
}

onMounted(() => {
  void read();
});
</script>

<template>
  <div class="flex h-dvh min-h-0 flex-col bg-default">
    <div class="flex h-12 shrink-0 items-center border-b border-default px-4 sm:px-6" data-screen-bar>
      <HintTip v-if="stand === 'ready'" class="block min-w-0 truncate text-sm font-medium text-highlighted" style="align-self: center" :text="titleLine" cut>{{ titleLine }}</HintTip>
      <span v-else class="text-sm font-medium text-highlighted">{{ $t("note.title") }}</span>
    </div>

    <div v-if="stand === 'loading'" role="status" :aria-label="$t('note.status.loading')" class="flex w-full flex-col gap-4 px-4 py-6 sm:px-6">
      <USkeleton class="h-9 w-2/5 rounded-md" />
      <div class="flex flex-col gap-2">
        <USkeleton class="h-4 w-full rounded-sm" />
        <USkeleton class="h-4 w-3/4 rounded-sm" />
        <USkeleton class="h-4 w-full rounded-sm" />
      </div>
    </div>

    <div v-else-if="stand === 'missing'" class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <UIcon name="i-material-symbols-link-off" class="size-10 text-dimmed" />
      <p class="text-sm text-muted">{{ $t("note.share.missing") }}</p>
    </div>

    <div v-else-if="stand === 'failed'" role="alert" class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <UIcon name="i-material-symbols-error-outline" class="size-10 text-error" />
      <p class="text-sm text-error">{{ $t("note.error.read_failed") }}</p>
      <UButton color="neutral" variant="soft" icon="i-material-symbols-refresh" :label="$t('note.action.retry')" @click="read" />
    </div>

    <NoteEditor v-else-if="note !== null" :note-id="note.id" :doc="note.doc" :title="titleLine" :blobs="blobs" readonly :toolbar="false" />
  </div>
</template>
