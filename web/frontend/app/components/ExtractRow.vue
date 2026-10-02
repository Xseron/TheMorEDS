<template>
  <div class="flex items-baseline gap-2 py-1">
    <dt class="shrink-0 text-muted">{{ label }}</dt>
    <span aria-hidden="true" class="min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-rule" />
    <dd class="max-w-[62%] text-right [overflow-wrap:anywhere]"><slot /></dd>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>
