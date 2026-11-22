<script setup lang="ts">
// The dev host's own frame: a line saying what this is, and the bundle's pages rendering inside it.
// `UApp` stands here as it does at the console's root, so the library's floating parts — the tooltips
// every icon key wears — find their context here as they find it there. The console says everything on
// bmo-ui's one message pill and stands the library's toaster down, so this host does the same: a line
// told any other way is lost here as it is there.
import MessageIsland from "bmo-ui/app/components/MessageIsland.vue";
</script>

<template>
  <UApp :toaster="null">
    <div class="flex h-dvh min-h-0 flex-col">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-default bg-elevated px-3 text-xs text-muted">
        <NuxtLink to="/note" class="font-medium text-highlighted">bmo-note dev host</NuxtLink>
        <span>the bundle under a host of its own; the console relays at <code>/proxy/</code></span>
      </div>
      <div class="min-h-0 flex-1">
        <NuxtPage />
      </div>
    </div>
    <MessageIsland />
  </UApp>
</template>
