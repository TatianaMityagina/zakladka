<script setup lang="ts">
defineProps<{ done: number; total: number; label: string }>();
</script>

<template>
  <div class="digest-progress">
    <p>{{ label }} {{ done }} из {{ total }}…</p>
    <span class="progress-bar"><span :style="{ width: `${total ? (done / total) * 100 : 0}%` }" /></span>
    <p class="muted small">Каждая глава разбирается один раз, потом — мгновенно.</p>
  </div>
</template>
