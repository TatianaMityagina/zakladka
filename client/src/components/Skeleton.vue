<script setup lang="ts">
defineProps<{ label?: string; lines?: number }>();
</script>

<template>
  <div class="skeleton" role="status">
    <p v-if="label" class="muted small">{{ label }}</p>
    <span v-for="i in lines ?? 4" :key="i" />
  </div>
</template>
