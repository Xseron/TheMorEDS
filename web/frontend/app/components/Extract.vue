<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <section class="card-white" aria-live="polite">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <SealStatus v-if="lookup" :status="lookup.status" />
      <span v-else class="h-7 w-28 animate-pulse rounded-full bg-lilac-soft" />
      <AddressText v-if="lookup && lookup.status !== 'invalid'" :address="lookup.address" />
      <span v-else class="font-mono text-[14px] text-muted">{{ address }}</span>
    </header>

    <template v-if="sealed">
      <h2 class="mt-5">{{ lookup.seal.name }}</h2>
      <p class="mt-1 text-muted">{{ country(lookup.seal.jurisdiction) }} · Legal entity · {{ ['Wallet', 'Program', 'Mint'][lookup.seal.kind] ?? lookup.seal.kind }}</p>
      <dl class="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <ExtractRow label="Trust level">{{ lookup.seal.trustLevel === 1 ? 'On-chain: certificate and signature verified by the program' : 'Attested: signature checked off-chain by an attestor' }}</ExtractRow>
        <ExtractRow label="Confirmed by">
          <template v-if="lookup.trust">{{ lookup.trust.name }}, {{ lookup.trust.kind === 1 ? 'attestor' : 'certificate authority' }}, {{ lookup.trust.country }}</template>
          <span v-if="lookup.trustIsTest" class="ml-2 rounded-full border border-coral px-2 text-[12px] font-bold text-refusal">TEST</span>
          <div class="mt-1"><AddressText :address="lookup.seal.trustService" /></div>
        </ExtractRow>
        <ExtractRow label="Valid">{{ date(lookup.seal.createdAt) }} to {{ date(lookup.seal.expiresAt) }}</ExtractRow>
        <ExtractRow label="Controller"><AddressText :address="lookup.seal.controller" /></ExtractRow>
        <ExtractRow label="Seal account"><AddressText :address="lookup.sealPda" /></ExtractRow>
        <ExtractRow v-if="lookup.seal.certificate !== ZERO_ADDRESS" label="Certificate"><AddressText :address="lookup.seal.certificate" /></ExtractRow>
        <ExtractRow label="Identifier hash" class="sm:col-span-2">
          <span class="font-mono text-[13px]">{{ lookup.seal.identifierHash }}</span>
          <p class="note mt-1">sha256(salt, jurisdiction, BIN or registry number); the salt stays with the owner, no personal data on-chain</p>
        </ExtractRow>
        <ExtractRow label="Checked" class="sm:col-span-2">slot {{ lookup.slot.toLocaleString('en-US') }}, {{ lookup.checkedAt.toLocaleTimeString('en-GB') }}</ExtractRow>
      </dl>
    </template>
    <p v-else-if="lookup?.status === 'none'" class="mt-5">No seal. The registry does not know who stands behind this address.</p>
    <p v-else-if="lookup?.status === 'invalid'" class="mt-5">This is not a Solana address.</p>
    <div v-else class="mt-5 space-y-3">
      <span class="block h-8 w-2/3 animate-pulse rounded bg-lilac-soft" />
      <span class="block h-4 w-1/2 animate-pulse rounded bg-lilac-soft" />
      <div class="grid gap-5 sm:grid-cols-2"><span v-for="i in 4" :key="i" class="block h-10 animate-pulse rounded bg-lilac-soft" /></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ZERO_ADDRESS } from '~/utils/registry'
import type { Lookup } from '~/composables/useRegistry'

const props = defineProps<{ address: string; lookup: Lookup | null }>()
const sealed = computed(() => props.lookup?.status === 'valid' || props.lookup?.status === 'expired')
const date = (s: bigint) => new Date(Number(s) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const names = new Intl.DisplayNames(['en'], { type: 'region' })
const country = (code: string) => { try { return `${names.of(code)} (${code})` } catch { return code } }
</script>
