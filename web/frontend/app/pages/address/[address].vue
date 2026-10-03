<template>
  <div class="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:grid-rows-[auto_1fr]">
    <!-- На широком экране заголовок слева, выписка справа на сиреневой плашке; на телефоне всё столбиком -->
    <header class="lg:col-start-1 lg:row-start-1">
      <p class="eyebrow">Registry extract</p>
      <h1 class="mt-3">Who stands behind this address?</h1>
    </header>
    <div class="band -mx-5 rounded-none p-5 sm:mx-0 sm:rounded-card md:p-10 lg:col-start-2 lg:self-start lg:row-span-2 lg:row-start-1">
      <p v-if="error" class="mb-5 rounded-control bg-coral/15 p-4 text-refusal">{{ error }}</p>
      <Extract :address="text" :lookup="result" />
      <div v-if="own" class="mt-6 flex flex-wrap items-center gap-4">
        <RevokeButton :address="text" :seal-pda="sealed!.sealPda" @revoked="load" />
        <span class="note">This is your wallet. Revoking closes the seal account and refunds its rent</span>
      </div>
    </div>
    <p class="text-[15px] font-bold lg:col-start-1 lg:row-start-2"><NuxtLink to="/">Check another address</NuxtLink></p>
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
