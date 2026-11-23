<script setup lang="ts">
// The Agent over one passage (`docs/design.md`, 「Agent」): the menu of set actions and a line for the reader's
// own words, then the result under the passage before anything changes. The reader replaces the
// passage with it, inserts it below, asks again, asks a further change, or discards it. The rounds over
// one passage are held while its result stands and dropped when it is placed or discarded.

import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { ASK_ACTIONS, ASK_GROUPS, askPassage } from "../domain/agent";
import { unansweredKey } from "../domain/talk";

import type { CommandPaletteGroup, CommandPaletteItem } from "@nuxt/ui";
import type { AskAnswer } from "../domain/agent";
import type { AgentCall, TalkTurn } from "../domain/talk";

interface Props {
  /** The Agent the menu asks, over the open note. */
  agent: AgentCall;
  /** The passage as lines in the note's grammar; null while none is taken. */
  passage: string[] | null;
  /** Whether the passage holds an image or a table, which no line brings back. */
  opaque: boolean;
  /** What the result stands under: the passage's last block. */
  anchor: { getBoundingClientRect: () => DOMRect } | undefined;
}

const props = defineProps<Props>();
const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{ place: [how: "replace" | "below", lines: string[]] }>();

const i18n = useI18n();

type Stage = "menu" | "asking" | "result" | "failed";

const stage = ref<Stage>("menu");
const search = ref("");
const further = ref("");
const instruction = ref("");
const turns = ref<TalkTurn[]>([]);
const answer = ref<AskAnswer | null>(null);
const failure = ref("");

// A new opening starts over: the menu, no rounds, nothing written.
watch(open, (now) => {
  if (!now) return;

  stage.value = "menu";
  search.value = "";
  further.value = "";
  turns.value = [];
  answer.value = null;
});

const groups = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  const own = search.value.trim();
  const sets = ASK_GROUPS.map((group) => ({
    id: group,
    label: i18n.t(`note.agent.group.${group}`),
    items: ASK_ACTIONS.filter((action) => action.group === group).map((action) => ({
      label: i18n.t(`note.agent.action.${action.id}`),
      icon: action.icon,
      onSelect: () => void run(action.rule)
    }))
  }));

  if (own === "") return sets;

  // The reader's own words lead the list, so Enter sends them as they stand.
  return [
    {
      id: "own",
      ignoreFilter: true,
      items: [{ label: i18n.t("note.agent.own", { words: own }), icon: "i-material-symbols-send", onSelect: () => void run(own) }]
    },
    ...sets
  ];
});

/** One round: the instruction over the passage, with the rounds before it. */
async function run(words: string): Promise<void> {
  if (props.passage === null || stage.value === "asking") return;

  instruction.value = words;
  stage.value = "asking";

  try {
    const got = await askPassage(props.agent, { passage: props.passage, instruction: words, turns: turns.value });

    if (got === null) {
      failure.value = i18n.t("note.talk.no_answer");
      stage.value = "failed";

      return;
    }

    turns.value = [...turns.value, { owner: true, text: words }, { owner: false, text: got.words }];
    answer.value = got;
    stage.value = "result";
  } catch (error) {
    failure.value = i18n.t(unansweredKey(error));
    stage.value = "failed";
  }
}

function again(): void {
  // Asking again sets the earlier result aside: the same instruction, over the passage as it stood.
  // A round that failed left no result to set aside.
  if (stage.value === "result") turns.value = turns.value.slice(0, -2);

  void run(instruction.value);
}

function askFurther(): void {
  const words = further.value.trim();

  if (words === "") return;

  further.value = "";
  void run(words);
}

function place(how: "replace" | "below"): void {
  const lines = answer.value?.lines;

  if (lines === null || lines === undefined) return;

  emit("place", how, lines);
  open.value = false;
}

const shown = computed(() => answer.value?.lines?.join("\n") ?? answer.value?.words ?? "");
const placeable = computed(() => answer.value?.lines !== null && answer.value?.lines !== undefined);
</script>

<template>
  <UPopover
    v-model:open="open"
    :reference="props.anchor"
    :dismissible="stage !== 'asking'"
    :content="{ side: 'bottom', align: 'start', sideOffset: 8, collisionPadding: 16 }"
    :ui="{ content: 'w-[min(34rem,calc(100vw-2rem))] p-0' }"
  >
    <template #content>
      <UCommandPalette
        v-if="stage === 'menu'"
        v-model:search-term="search"
        :groups="groups"
        icon="i-material-symbols-auto-awesome-outline"
        :placeholder="$t('note.agent.placeholder')"
        :close="false"
        class="max-h-96"
      />

      <div v-else-if="stage === 'asking'" role="status" class="flex flex-col gap-3 p-4">
        <p class="flex items-center gap-2 text-sm text-muted">
          <UIcon name="i-material-symbols-auto-awesome-outline" class="size-4 shrink-0 animate-pulse text-primary" />
          {{ $t("note.agent.writing") }}
        </p>
        <USkeleton class="h-4 w-full rounded-sm" />
        <USkeleton class="h-4 w-4/5 rounded-sm" />
        <USkeleton class="h-4 w-3/5 rounded-sm" />
      </div>

      <div v-else-if="stage === 'failed'" role="alert" class="flex flex-col gap-3 p-4">
        <p class="text-sm text-error">{{ failure }}</p>
        <div class="flex justify-end gap-2">
          <UButton size="sm" color="neutral" variant="ghost" :label="$t('note.agent.discard')" @click="open = false" />
          <UButton size="sm" color="neutral" variant="subtle" icon="i-material-symbols-refresh" :label="$t('note.agent.again')" @click="again" />
        </div>
      </div>

      <div v-else class="flex flex-col">
        <div class="flex items-center gap-2 border-b border-default px-4 py-2 text-sm text-muted">
          <UIcon name="i-material-symbols-auto-awesome-outline" class="size-4 shrink-0 text-primary" />
          <span class="min-w-0 flex-1 truncate">{{ instruction }}</span>
        </div>

        <div class="max-h-72 overflow-y-auto overscroll-contain px-4 py-3">
          <p class="text-sm break-words whitespace-pre-wrap text-highlighted">{{ shown }}</p>
        </div>

        <p v-if="placeable && props.opaque" class="px-4 pb-2 text-sm text-muted">{{ $t("note.agent.opaque") }}</p>

        <div class="flex flex-wrap items-center justify-end gap-2 border-t border-default px-3 py-2">
          <UButton size="sm" color="neutral" variant="ghost" :label="$t('note.agent.discard')" @click="open = false" />
          <UButton size="sm" color="neutral" variant="ghost" icon="i-material-symbols-refresh" :label="$t('note.agent.again')" @click="again" />
          <UButton size="sm" color="neutral" variant="subtle" icon="i-material-symbols-vertical-align-bottom" :disabled="!placeable" :label="$t('note.agent.below')" @click="place('below')" />
          <UButton size="sm" icon="i-material-symbols-swap-horiz" :disabled="!placeable || props.opaque" :label="$t('note.agent.replace')" @click="place('replace')" />
        </div>

        <div class="border-t border-default p-2">
          <UChatPrompt
            v-model="further"
            variant="soft"
            :rows="1"
            :maxrows="4"
            :autofocus="false"
            :placeholder="$t('note.agent.further')"
            :aria-label="$t('note.agent.further')"
            @submit="askFurther"
          >
            <UChatPromptSubmit size="sm" :disabled="further.trim() === ''" :aria-label="$t('note.action.send')" />
          </UChatPrompt>
        </div>
      </div>
    </template>
  </UPopover>
</template>
