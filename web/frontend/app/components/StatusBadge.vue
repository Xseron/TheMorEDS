<template>
  <span :data-testid="testid" class="status inline-flex items-center gap-2 rounded-full px-3 py-1 text-[14px] font-bold" :class="look.cls">
    <span class="h-2 w-2 rounded-full" :class="look.dot" aria-hidden="true" />{{ text }}
  </span>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ text: string; tone?: 'violet' | 'muted' | 'coral'; testid?: string }>(), { tone: 'violet', testid: 'status-badge' })
const looks = {
  violet: { cls: 'bg-lilac text-violet', dot: 'bg-violet' },
  muted: { cls: 'bg-lilac-soft text-muted', dot: 'bg-muted' },
  coral: { cls: 'bg-coral/15 text-refusal', dot: 'bg-coral' },
} as const
const look = computed(() => looks[props.tone])
</script>

<style scoped>
.status { animation: appear 160ms ease-out both; }
@keyframes appear { from { opacity: 0; } to { opacity: 1; } }
</style>
