<template>
  <p v-if="failed" class="note">Could not reach Solana devnet. Reload the page to try again</p>
  <Extract v-else :address="address" :lookup="lookup" />
</template>

<script setup lang="ts">
import { DEMO } from '~/utils/registry'
import type { Lookup } from '~/composables/useRegistry'

// Выписка кошелька B с devnet; при пререндере пустой бланк, данные приходят в браузере
const address = DEMO.b as string
const lookup = ref<Lookup | null>(null)
const failed = ref(false)
onMounted(async () => {
  try { lookup.value = await useRegistry().lookup(address) } catch { failed.value = true }
})
</script>
