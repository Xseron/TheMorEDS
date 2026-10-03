<template>
  <div class="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
    <header>
      <p class="eyebrow">Bond dossier</p>
      <h1 class="mt-3">{{ title }}</h1>
      <p class="mt-5 text-muted">Terms, events and holder registers, read from Solana devnet every 10 seconds</p>
    </header>

    <div class="band -mx-5 space-y-4 rounded-none p-5 sm:mx-0 sm:rounded-card md:p-10 lg:self-start">
      <ClientOnly>
        <div v-if="!mint || missing" class="card-white">
          <StatusBadge text="No such bond" tone="coral" />
          <p class="mt-4">This address is not a bond of this program. <NuxtLink to="/kase">Issue a test bond</NuxtLink> or <NuxtLink :to="`/kase/bond/${referenceMint}`">open the reference bond</NuxtLink></p>
        </div>
        <div v-else-if="!view" class="card-white space-y-3">
          <span class="block h-8 w-2/3 animate-pulse rounded bg-lilac-soft" />
          <div class="grid gap-5 sm:grid-cols-2"><span v-for="i in 4" :key="i" class="block h-10 animate-pulse rounded bg-lilac-soft" /></div>
        </div>
        <template v-else>
          <BondTerms :view="view" :mint="mint" :issuer-name="names[view.bond.issuer]" :issuer-no-seal="noSeal.has(view.bond.issuer)" />
          <EventTimeline :view="view" :now="now" />
          <BondActions :view="view" :mint="mint" :now="now" :names="names" @busy="onBusy" @changed="reload" />

          <section class="card-white">
            <h2 class="h3">Register of holders now</h2>
            <p v-if="!view.rows.length" class="note mt-2">No holders yet. Issue bonds to a holder to start the register</p>
            <div v-else class="mt-6 overflow-x-auto">
              <table class="w-full text-[15px]">
                <thead><tr class="label text-left"><th class="pb-2 pr-4">Holder</th><th class="pb-2 pr-4">Bonds</th><th class="pb-2">Last event passed</th></tr></thead>
                <tbody>
                  <tr v-for="r in view.rows" :key="r.address" class="border-t border-line align-top">
                    <td class="py-3 pr-4">{{ names[r.owner] ?? '' }}<span class="block"><AddressText :address="r.owner" /></span></td>
                    <td class="py-3 pr-4 font-mono">{{ r.balance }}</td>
                    <td class="py-3 font-mono">{{ r.lastEvent }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <HolderRegister v-for="e in recorded" :key="e.k" :view="view" :k="e.k" :names="names" />
          <p v-if="!recorded.length" class="note px-1">The registers appear here after the first record date</p>
        </template>
        <template #fallback>
          <div class="card-white"><span class="block h-8 w-2/3 animate-pulse rounded bg-lilac-soft" /></div>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Address } from '@solana/kit'
import { parseAddress } from '~/utils/registry'

useSeoMeta({ title: 'Bond dossier', robots: 'noindex' })

const route = useRoute()
const referenceMint = useRuntimeConfig().public.kaseReferenceMint
const mint = computed<Address | null>(() => parseAddress(String(route.params.mint)))
const { view, missing, load, pause, resume } = useBond(mint)
// Действие идёт: опрос стоит. После него один свежий прогон, сбой просто ждёт следующего опроса
const onBusy = (b: boolean) => (b ? pause() : resume())
const reload = () => load().catch(() => {})
const { lookup } = useRegistry()
const names = ref<Record<string, string>>({})
// Подтверждённо без печати: сбой запроса сюда не попадает и повторяется на следующем опросе
const noSeal = ref(new Set<string>())
let looking = false
const title = computed(() => (view.value && names.value[view.value.bond.issuer] ? `Bond of ${names.value[view.value.bond.issuer]}` : 'Bond dossier'))

// Часы кластера между опросами: последнее время блока плюс прошедшее локально
const tick = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
onMounted(() => { ticker = setInterval(() => (tick.value = Date.now()), 1_000) })
onBeforeUnmount(() => clearInterval(ticker))
const now = computed(() => (view.value ? view.value.now + BigInt(Math.floor((tick.value - view.value.loadedAt) / 1000)) : 0n))

const recorded = computed(() => (view.value?.events ?? []).filter(e => e.processed > 0))

watch(() => view.value && view.value.loadedAt, async () => {
  if (!view.value || looking) return
  looking = true
  try {
    const owners = [view.value.bond.issuer, ...view.value.rows.map(r => r.owner)].filter(o => !(o in names.value) && !noSeal.value.has(o))
    for (const o of owners) {
      try {
        const l = await lookup(o)
        if (l.status === 'valid' || l.status === 'expired') names.value = { ...names.value, [o]: l.seal.name }
        else if (l.status === 'none') noSeal.value = new Set(noSeal.value).add(o)
      } catch { /* имя необязательно: адрес и так показан */ }
    }
  } finally { looking = false }
})
</script>
