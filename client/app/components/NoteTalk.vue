<script setup lang="ts">
// The talk about one note (`docs/design.md`, 「The talk panel」): the reader asks for a change, the note
// assistant of his account answers with the whole note as lines, and the changed runs land in the open editor at
// once. The talk is kept here alone — nothing keeps a turn of it — and every turn is handed with the turns before
// it. Where the anchored patch cannot land, the note stands as
// it was and the panel says why, and the whole answer waits for the reader's word to be applied outright —
// an image or a table in the note is kept and moved into the new body, and a refusal names what cannot be.
//
// The panel stands in the column beside the note (`NotePanel`), so the note keeps its width and the reader may
// go on writing.

import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { askQuestion } from "bmo-ui/app/domain/question";
import { useNarrow } from "bmo-ui/app/domain/screen";

import NotePanel from "./NotePanel.vue";
import NoteTalkBody from "./NoteTalkBody.vue";
import { planPatch } from "../domain/patch";
import { rowOf } from "../domain/text";
import { askNote, noteAnswer, unansweredKey } from "../domain/talk";

import type { OpaqueKind, Rewrite } from "../domain/rows";
import type { Op, Why } from "../domain/patch";
import type { AgentCall, TalkTurn } from "../domain/talk";

interface Props {
  /** The Agent the talk asks, over the open note. */
  agent: AgentCall;
  /** The note's body now, one line per block. */
  lines: () => string[];
  /** Writes the patch's runs into the open editor. */
  apply: (ops: Op[]) => boolean;
  /** Writes the whole body from the answer, where the anchored patch could not land. */
  replace: (lines: string[]) => Rewrite;
  /** Writes the title the answer renamed the note to into the document's own title. */
  rename: (title: string) => boolean;
}

const props = defineProps<Props>();
const open = defineModel<boolean>("open", { default: false });

const i18n = useI18n();
const phone = useNarrow();

const turns = ref<TalkTurn[]>([]);
const said = ref("");
const busy = ref(false);
const failure = ref<string | null>(null);
const fallback = ref<{ lines: string[]; title: string | null } | null>(null);

// Why the anchored patch came apart, as the panel names it.
const WHY: Record<Why, string> = {
  anchor: "note.talk.patch_anchor",
  owner: "note.talk.patch_owner",
  opaque: "note.talk.patch_opaque",
  big: "note.talk.patch_big"
};

const canSend = computed(() => !busy.value && said.value.trim() !== "");

// The blocks a refusal names: only the kinds it could not place, counted as the greater of what the
// note holds and what the answer draws, each wearing the kind's word and the kinds joined with a
// comma. The words are the bar's own, so the line speaks of an image and a table as the reader knows
// them.
function namesOf(kinds: readonly OpaqueKind[], base: string[], next: string[]): string {
  const parts: string[] = [];

  for (const kind of kinds) {
    const read = (lines: string[]): number => lines.filter((line) => rowOf(line).kind === kind).length;
    const count = Math.max(read(base), read(next));

    if (count > 0) parts.push(i18n.t(`note.talk.${kind}_count`, { n: count }));
  }

  return parts.join(", ");
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
    const answer = await askNote(props.agent, { lines: base, turns: earlier, said: words });

    if (answer === null) {
      failure.value = i18n.t("note.talk.no_answer");

      return;
    }

    turns.value.push({ owner: false, text: answer });

    const next = noteAnswer(answer);

    // Words alone change nothing: the note stands as it is, under the title it has.
    if (next === null) return;

    const plan = planPatch(base, next.lines, props.lines());

    if (plan.ok) {
      if (plan.ops.length > 0 && !props.apply(plan.ops)) {
        failure.value = i18n.t("note.talk.apply_failed");

        return;
      }

      // The change landed, so a rename it carried lands with it; the editor's own change saves it.
      if (next.title !== null) props.rename(next.title);
    } else {
      fallback.value = { lines: next.lines, title: next.title };
      failure.value = i18n.t(WHY[plan.why]);
    }
  } catch (error) {
    failure.value = i18n.t(unansweredKey(error));
  } finally {
    busy.value = false;
  }
}

async function applyWhole(): Promise<void> {
  const held = fallback.value;

  if (held === null) return;

  const through = await askQuestion({
    title: i18n.t("note.talk.replace_question"),
    effect: i18n.t("note.talk.replace_effect"),
    confirm: i18n.t("note.action.apply_all")
  });

  if (!through) return;

  const done = props.replace(held.lines);

  if (!done.ok) {
    // The rewrite holds nothing it could not place, and the note stands as it did: the plain failure
    // says all the reader has.
    failure.value =
      done.kinds.length === 0
        ? i18n.t("note.talk.apply_failed")
        : i18n.t("note.talk.replace_opaque", { names: namesOf(done.kinds, props.lines(), held.lines) });

    return;
  }

  if (held.title !== null) props.rename(held.title);

  fallback.value = null;
  failure.value = null;
}
</script>

<template>
  <NotePanel v-model:open="open" :title="$t('note.talk.title')" :width-label="$t('note.talk.width')">
    <NoteTalkBody
      v-model:said="said"
      :turns="turns"
      :busy="busy"
      :failure="failure"
      :fallback="fallback !== null"
      :can-send="canSend"
      :phone="phone"
      @send="send"
      @apply="applyWhole"
    />
  </NotePanel>
</template>
