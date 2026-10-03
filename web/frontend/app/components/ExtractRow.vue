<template>
  <div class="min-w-0">
    <dt class="label">{{ label }}</dt>
    <dd class="mt-1 [overflow-wrap:anywhere]"><slot /></dd>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>
