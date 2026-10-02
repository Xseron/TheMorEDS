<template>
  <span class="inline-flex items-center gap-1 font-mono">
    <a :href="explorer(address)" target="_blank" rel="noopener" :title="address">{{ full ? address : shortAddress(address) }}</a>
    <button type="button" class="text-muted hover:text-ink" :aria-label="copied ? 'Copied' : 'Copy address'" @click="copy">
      <Icon :name="copied ? 'ph:check' : 'ph:copy'" size="15" />
    </button>
  </span>
</template>

<script setup lang="ts">
import { shortAddress } from '~/utils/registry'

const props = defineProps<{ address: string; full?: boolean }>()
const { explorer } = useSolana()
const copied = ref(false)
async function copy() {
  try { await navigator.clipboard.writeText(props.address); copied.value = true; setTimeout(() => (copied.value = false), 1500) } catch { /* буфер недоступен, ссылка рядом */ }
}
</script>
