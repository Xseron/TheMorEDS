<template>
  <div class="mx-auto max-w-[760px]">
    <h1 class="mb-6 text-[28px]">Who stands behind this address?</h1>
    <p v-if="error" class="mb-4 border border-refusal p-3 text-refusal">{{ error }}</p>
    <Extract :address="text" :lookup="result" />
    <p v-if="own" class="mt-4 flex items-center gap-3">
      <RevokeButton :address="text" :seal-pda="sealed!.sealPda" @revoked="load" />
      <span class="note">This is your wallet. Revoking closes the seal account and refunds its rent.</span>
    </p>
    <p class="note mt-4"><NuxtLink to="/">Check another address</NuxtLink></p>
  </div>
</template>

<script setup lang="ts">
import { describeError } from '~/utils/errors'
import { shortAddress } from '~/utils/registry'
import type { Lookup } from '~/composables/useRegistry'

const route = useRoute()
const text = computed(() => String(route.params.address ?? ''))
const { lookup } = useRegistry()
const { attestorUrl } = useSolana()
const { wallet } = useWallet()
const result = ref<Lookup | null>(null)
const error = ref('')
const own = computed(() => (result.value?.status === 'valid' || result.value?.status === 'expired') && wallet.value?.address === result.value.seal.controller)
const sealed = computed(() => (result.value && 'sealPda' in result.value ? result.value : null))

async function load() {
  const t = text.value
  result.value = null
  error.value = ''
  try {
    const r = await lookup(t)
    if (t === text.value) result.value = r
  } catch (e) {
    // Ответ по уже покинутому адресу не показываем
    if (t === text.value) error.value = describeError(e, { attestorUrl })
  }
}
watch(text, load, { immediate: true })

useSeoMeta({ title: () => `Who stands behind ${shortAddress(text.value)}? MOR registry extract`, robots: 'noindex' })
</script>
