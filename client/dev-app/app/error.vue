<script setup lang="ts">
// The dev host shows what broke with its stack, where the default error page would only show the line.
const props = defineProps<{ error: { message?: string; stack?: string } }>();
</script>

<template>
  <pre class="p-4 text-sm whitespace-pre-wrap">{{ props.error.message }}\n{{ props.error.stack }}</pre>
</template>
