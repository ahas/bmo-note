<script setup lang="ts">
// The words and the input of the talk about one note (`docs/design.md`, 「The AI talk panel」), drawn the
// same in the docked panel and in the bottom drawer. The panel around it owns where it stands; this owns
// only the turns, what the last turn left to act on, and the box the owner writes in.

import { nextTick, onMounted, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { TalkTurn } from "../domain/talk";

interface Props {
  turns: TalkTurn[];
  busy: boolean;
  failure: string | null;
  /** Whether an answer could not be written as a patch and waits for the reader's word. */
  fallback: boolean;
  canSend: boolean;
  /** Whether Enter must break the line instead of sending it, as on a phone. */
  phone: boolean;
}

const props = defineProps<Props>();
const said = defineModel<string>("said", { required: true });

const emit = defineEmits<{ send: []; apply: [] }>();

const i18n = useI18n();
const list = useTemplateRef<HTMLElement>("list");

async function scrollDown(): Promise<void> {
  await nextTick();

  if (list.value !== null) list.value.scrollTop = list.value.scrollHeight;
}

// A turn the reader wrote or an answer that arrived takes the list to its end, where it is read;
// a panel opened again on a talk already held shows the same end.
onMounted(() => void scrollDown());

watch(() => props.turns.length, () => void scrollDown());

function onSend(): void {
  if (!props.canSend) return;

  emit("send");
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <p v-if="turns.length === 0" class="text-sm text-muted">{{ i18n.t("note.talk.empty") }}</p>

    <ol ref="list" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain" :aria-label="i18n.t('note.talk.title')">
      <li v-for="(turn, at) in turns" :key="at" class="flex flex-col gap-1">
        <p class="text-sm font-medium" :class="turn.owner ? 'text-primary' : 'text-muted'">
          {{ turn.owner ? i18n.t("note.label.you") : i18n.t("note.label.supervisor") }}
        </p>
        <p class="whitespace-pre-wrap break-words text-sm text-highlighted" :class="turn.owner ? '' : 'rounded-lg bg-elevated p-3'">{{ turn.text }}</p>
      </li>
    </ol>

    <p v-if="busy" class="text-sm text-muted" role="status">{{ i18n.t("note.talk.answering") }}</p>
    <p v-if="failure !== null" class="text-sm text-error" role="alert">{{ failure }}</p>
    <div v-if="fallback" class="flex items-center gap-2">
      <UButton size="sm" color="neutral" variant="subtle" @click="emit('apply')">{{ i18n.t("note.action.apply_all") }}</UButton>
    </div>

    <!-- The console's chat prompt: Enter sends on a wide screen and Shift+Enter breaks the line; on a
         phone Enter breaks the line and the send key sends. -->
    <UChatPrompt
      v-model="said"
      class="shrink-0"
      variant="subtle"
      :rows="2"
      :maxrows="phone ? undefined : 8"
      :autofocus="!phone"
      :submit-on-enter="!phone"
      :disabled="busy"
      :placeholder="i18n.t('note.talk.placeholder')"
      :aria-label="i18n.t('note.talk.placeholder')"
      @submit="onSend"
    >
      <UChatPromptSubmit :loading="busy" :disabled="!canSend" :aria-label="i18n.t('note.action.send')" />
    </UChatPrompt>
  </div>
</template>
