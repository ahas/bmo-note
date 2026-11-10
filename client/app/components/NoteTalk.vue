<script setup lang="ts">
// The talk about one note (`docs/design.md`, 「The AI talk panel」): the owner asks for a change, the
// supervisor of his account answers with the whole note as lines, and the changed runs land in the
// open editor at once. The talk is kept here alone — the receiver keeps no turn of it — and every
// turn is handed with the turns before it. Where the anchored patch cannot land, the note stands as
// it was and the panel says why; the plain-lines fallback is offered where no image or table would go.
//
// The panel is docked beside the document on a wide viewport, a column of its own so the note keeps
// its width and the reader may go on writing; below that width it rises from the bottom edge.

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import UDrawer from "@nuxt/ui/components/Drawer.vue";
import HintTip from "bmo-ui/app/components/HintTip.vue";
import { askQuestion } from "bmo-ui/app/domain/question";
import { useNarrow } from "bmo-ui/app/domain/screen";

import NoteTalkBody from "./NoteTalkBody.vue";
import { planPatch } from "../domain/patch";
import { opaqueLine } from "../domain/text";
import { askNote, fencedAnswer } from "../domain/talk";

import type { Op, Why } from "../domain/patch";
import type { TalkTurn } from "../domain/talk";

/// Where the panel stops being a drawer and stands as a column of its own beside the note.
const DOCK_QUERY = "(min-width: 1024px)";

interface Props {
  noteId: string;
  title: string;
  /** The note's body now, one line per block. */
  lines: () => string[];
  /** Writes the patch's runs into the open editor. */
  apply: (ops: Op[]) => boolean;
  /** Writes the whole body from the answer, where the anchored patch could not land. */
  replace: (lines: string[]) => boolean;
}

const props = defineProps<Props>();
const open = defineModel<boolean>("open", { default: false });

const i18n = useI18n();
const phone = useNarrow();
const docked = useNarrow(DOCK_QUERY);

const turns = ref<TalkTurn[]>([]);
const said = ref("");
const busy = ref(false);
const failure = ref<string | null>(null);
const fallback = ref<{ lines: string[]; why: Why } | null>(null);

// Why the anchored patch came apart, as the panel names it.
const WHY: Record<Why, string> = {
  anchor: "note.talk.patch_anchor",
  owner: "note.talk.patch_owner",
  opaque: "note.talk.patch_opaque",
  big: "note.talk.patch_big"
};

const canSend = computed(() => !busy.value && said.value.trim() !== "");
// The fallback rewrites plain lines only: an image or a table on either side would not come back.
const canFallback = computed(() => fallback.value !== null && !props.lines().some(opaqueLine) && !fallback.value.lines.some(opaqueLine));

// The docked panel is put away by Escape, as the drawer it replaces is.
function onEscape(event: KeyboardEvent): void {
  if (docked.value && open.value && event.key === "Escape") {
    event.preventDefault();
    open.value = false;
  }
}

onMounted(() => addEventListener("keydown", onEscape));
onBeforeUnmount(() => removeEventListener("keydown", onEscape));

function reasonOf(error: unknown): string {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;

  switch (code) {
    case "limit":
      return i18n.t("note.talk.unanswered_limit");
    case "outage":
      return i18n.t("note.talk.unanswered_outage");
    case "not-ready":
      return i18n.t("note.talk.unanswered_ready");
    default:
      return i18n.t("note.talk.unanswered");
  }
}

async function send(): Promise<void> {
  const words = said.value.trim();

  if (words === "" || busy.value) return;

  const base = props.lines();
  const earlier = turns.value.map((turn) => ({ owner: turn.owner, text: turn.text }));

  turns.value.push({ owner: true, text: words });
  said.value = "";
  busy.value = true;
  failure.value = null;
  fallback.value = null;

  try {
    const answer = await askNote({ noteId: props.noteId, title: props.title, lines: base, turns: earlier, said: words });

    if (answer === null) {
      failure.value = i18n.t("note.talk.no_answer");

      return;
    }

    turns.value.push({ owner: false, text: answer });

    const next = fencedAnswer(answer);

    // Words alone change nothing: the note stands as it is.
    if (next === null) return;

    const plan = planPatch(base, next, props.lines());

    if (plan.ok) {
      if (plan.ops.length > 0 && !props.apply(plan.ops)) failure.value = i18n.t("note.talk.apply_failed");
    } else {
      fallback.value = { lines: next, why: plan.why };
      failure.value = i18n.t(WHY[plan.why]);
    }
  } catch (error) {
    failure.value = reasonOf(error);
  } finally {
    busy.value = false;
  }
}

async function applyWhole(): Promise<void> {
  const held = fallback.value;

  if (held === null || !canFallback.value) return;

  const through = await askQuestion({
    title: i18n.t("note.talk.replace_question"),
    effect: i18n.t("note.talk.replace_effect"),
    confirm: i18n.t("note.action.apply_all")
  });

  if (!through) return;

  if (props.replace(held.lines)) {
    fallback.value = null;
    failure.value = null;
  } else {
    failure.value = i18n.t("note.talk.replace_blocked");
  }
}
</script>

<template>
  <!-- Docked beside the note on a wide viewport: a column of its own, parted from the document by one
       line, so the editor keeps its width and the reader may go on writing while the answer comes. -->
  <aside
    v-if="docked && open"
    class="flex w-80 shrink-0 flex-col border-s border-default bg-default"
    :aria-label="$t('note.talk.title')"
  >
    <div class="flex min-h-12 shrink-0 items-center gap-2 border-b border-default px-4">
      <div class="flex min-w-0 flex-1 flex-col">
        <p class="truncate text-sm font-medium text-highlighted">{{ $t("note.talk.title") }}</p>
        <p class="truncate text-sm text-muted">{{ props.title }}</p>
      </div>
      <HintTip :text="$t('note.action.close')" press>
        <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-close" :aria-label="$t('note.action.close')" @click="open = false" />
      </HintTip>
    </div>

    <div class="flex min-h-0 flex-1 flex-col p-4">
      <NoteTalkBody
        v-model:said="said"
        :turns="turns"
        :busy="busy"
        :failure="failure"
        :fallback="fallback !== null"
        :can-fallback="canFallback"
        :can-send="canSend"
        :phone="phone"
        @send="send"
        @apply="applyWhole"
      />
    </div>
  </aside>

  <!-- Below that width the panel rises from the bottom edge, and the note waits behind it. -->
  <UDrawer
    v-if="!docked"
    v-model:open="open"
    :ui="{ content: 'h-[85svh]', container: 'min-h-0 flex-1 overflow-hidden', body: 'flex min-h-0 flex-1 flex-col' }"
    :title="$t('note.talk.title')"
    :description="props.title"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <NoteTalkBody
          v-model:said="said"
          :turns="turns"
          :busy="busy"
          :failure="failure"
          :fallback="fallback !== null"
          :can-fallback="canFallback"
          :can-send="canSend"
          :phone="phone"
          @send="send"
          @apply="applyWhole"
        />
      </div>
    </template>
  </UDrawer>
</template>
