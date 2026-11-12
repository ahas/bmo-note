<script setup lang="ts">
// The way back from an open note to the notes list: the key that leads the screen's own row under the
// title bar, whichever row stands there (`docs/design.md`, 「The console surface」).

import { useRouter } from "vue-router";
import HintTip from "bmo-ui/app/components/HintTip.vue";

const router = useRouter();

async function goBack(): Promise<void> {
  await router.push("/note");
}
</script>

<template>
  <HintTip :text="$t('note.action.back')" press>
    <UButton size="sm" color="neutral" variant="ghost" square icon="i-material-symbols-arrow-back" :aria-label="$t('note.action.back')" data-bar="back" @click="goBack" />
  </HintTip>
</template>
