<script setup lang="ts">
// The talk about one note (`docs/design.md`, 「The AI talk panel」): the owner asks for a change, the
// supervisor of his account answers with the whole note as lines, and the changed runs land in the
// open editor at once. The talk is kept here alone — the receiver keeps no turn of it — and every
// turn is handed with the turns before it. Where the anchored patch cannot land, the note stands as
// it was and the panel says why; the plain-lines fallback is offered where no image or table would go.

import { computed, nextTick, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import UDrawer from "@nuxt/ui/components/Drawer.vue";
import USlideover from "@nuxt/ui/components/Slideover.vue";
import { askQuestion } from "bmo-ui/app/domain/question";
import { useNarrow } from "bmo-ui/app/domain/screen";

import { planPatch } from "../domain/patch";
import { opaqueLine } from "../domain/text";
import { askNote, fencedAnswer } from "../domain/talk";

import type { Op, Why } from "../domain/patch";
import type { TalkTurn } from "../domain/talk";

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
const narrow = useNarrow();
// At the side on a wide screen, up from the bottom edge on a narrow one. The wide panel stands over
// the page without a veil, and a press outside it puts it away, so the owner writes in the open note
// while the supervisor thinks and the answer still lands behind the closed panel. On a narrow screen
// the note waits behind the drawer.
const shell = computed(() => (narrow.value ? { ui: { content: "h-[85svh]" } } : { side: "right" as const, modal: false, overlay: false }));

const turns = ref<TalkTurn[]>([]);
const said = ref("");
const busy = ref(false);
const failure = ref<string | null>(null);
const fallback = ref<{ lines: string[]; why: Why } | null>(null);
const list = useTemplateRef<HTMLElement>("list");

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

async function scrollDown(): Promise<void> {
  await nextTick();

  if (list.value !== null) list.value.scrollTop = list.value.scrollHeight;
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
  await scrollDown();

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
    await scrollDown();
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

/** On a wide screen Enter sends and Shift+Enter breaks the line; a finger's Enter only breaks it. */
function onKey(event: KeyboardEvent): void {
  if (narrow.value || event.key !== "Enter" || event.shiftKey || event.isComposing) return;

  event.preventDefault();
  void send();
}
</script>

<template>
  <component :is="narrow ? UDrawer : USlideover" v-bind="shell" v-model:open="open" :title="$t('note.talk.title')" :description="props.title">
    <template #body>
      <div class="flex h-full min-h-0 flex-col gap-4">
        <p v-if="turns.length === 0" class="text-sm text-muted">{{ $t("note.talk.empty") }}</p>

        <ol ref="list" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain" :aria-label="$t('note.talk.title')">
          <li v-for="(turn, at) in turns" :key="at" class="flex flex-col gap-1">
            <p class="text-sm font-medium" :class="turn.owner ? 'text-primary' : 'text-muted'">
              {{ turn.owner ? $t("note.label.you") : $t("note.label.supervisor") }}
            </p>
            <p class="whitespace-pre-wrap break-words text-sm text-highlighted" :class="turn.owner ? '' : 'rounded-lg bg-elevated p-3'">{{ turn.text }}</p>
          </li>
        </ol>

        <p v-if="busy" class="text-sm text-muted" role="status">{{ $t("note.talk.answering") }}</p>
        <p v-if="failure !== null" class="text-sm text-error" role="alert">{{ failure }}</p>
        <div v-if="fallback !== null" class="flex items-center gap-2">
          <UButton size="sm" color="neutral" variant="subtle" :disabled="!canFallback" @click="applyWhole">{{ $t("note.action.apply_all") }}</UButton>
          <span v-if="!canFallback" class="text-sm text-muted">{{ $t("note.talk.replace_blocked") }}</span>
        </div>

        <div class="flex shrink-0 flex-col gap-2">
          <UTextarea
            v-model="said"
            :rows="2"
            :maxrows="8"
            autoresize
            :disabled="busy"
            :placeholder="$t('note.talk.placeholder')"
            :aria-label="$t('note.talk.placeholder')"
            @keydown="onKey"
          />
          <div class="flex justify-end">
            <UButton size="sm" :loading="busy" :disabled="!canSend" icon="i-material-symbols-send" :label="$t('note.action.send')" @click="send" />
          </div>
        </div>
      </div>
    </template>
  </component>
</template>
