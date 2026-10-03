<template>
  <StatusBadge testid="seal-status" :text="look.text" :tone="look.tone" />
</template>

<script setup lang="ts">
const props = defineProps<{ status: 'valid' | 'expired' | 'none' | 'invalid' | 'rejected' }>()
const looks = {
  valid: { text: 'Valid seal', tone: 'violet' },
  expired: { text: 'Expired', tone: 'muted' },
  none: { text: 'No seal', tone: 'coral' },
  invalid: { text: 'Not an address', tone: 'coral' },
  rejected: { text: 'Rejected', tone: 'coral' },
} as const
const look = computed(() => looks[props.status])
</script>
