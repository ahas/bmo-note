<script setup lang="ts">
// The dev host's own frame: a line saying what this is, and the bundle's pages rendering inside it.
</script>

<template>
  <div class="flex h-dvh min-h-0 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-default bg-elevated px-3 text-xs text-muted">
      <NuxtLink to="/note" class="font-medium text-highlighted">bmo-note dev host</NuxtLink>
      <span>the bundle under a host of its own; the console relays at <code>/proxy/</code></span>
    </div>
    <div class="min-h-0 flex-1">
      <NuxtPage />
    </div>
  </div>
</template>
