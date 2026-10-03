<template>
  <span data-testid="seal-status" class="status inline-flex items-center gap-2 rounded-full px-3 py-1 text-[14px] font-bold" :class="look.cls">
    <span class="h-2 w-2 rounded-full" :class="look.dot" aria-hidden="true" />{{ look.text }}
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ status: 'valid' | 'expired' | 'none' | 'invalid' | 'rejected' }>()
const looks = {
  valid: { text: 'Valid seal', cls: 'bg-lilac text-violet', dot: 'bg-violet' },
  expired: { text: 'Expired', cls: 'bg-lilac-soft text-muted', dot: 'bg-muted' },
  none: { text: 'No seal', cls: 'bg-coral/15 text-refusal', dot: 'bg-coral' },
  invalid: { text: 'Not an address', cls: 'bg-coral/15 text-refusal', dot: 'bg-coral' },
  rejected: { text: 'Rejected', cls: 'bg-coral/15 text-refusal', dot: 'bg-coral' },
} as const
const look = computed(() => looks[props.status])
</script>

<style scoped>
.status { animation: appear 160ms ease-out both; }
@keyframes appear { from { opacity: 0; } to { opacity: 1; } }
</style>
