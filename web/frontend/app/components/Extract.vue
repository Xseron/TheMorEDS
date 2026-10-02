<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <section class="relative border border-seal p-1" aria-live="polite">
    <div class="border border-seal px-5 py-4 sm:px-7 sm:py-6">
      <header class="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-rule pb-3 text-[15px]">
        <div><b>MOR registry of seals</b><br><span class="text-muted">Solana devnet</span></div>
        <div class="text-right">
          <span v-if="sealed">Extract No. <span class="font-mono">{{ shortAddress(lookup.sealPda) }}</span></span>
          <span v-else-if="lookup?.status === 'none'">No record</span>
          <span v-else>Extract</span>
          <br><span class="text-muted">{{ issued }}</span>
        </div>
      </header>

      <div class="sm:flex sm:items-start sm:gap-6">
        <div v-if="lookup && lookup.status !== 'valid'" class="my-4 sm:order-2 sm:my-0 sm:-mr-3 sm:mt-2 sm:rotate-[-6deg]">
          <Stamp v-if="lookup.status === 'invalid'" kind="refused" label="NOT AN ADDRESS" />
          <Stamp v-else-if="lookup.status === 'none'" kind="refused" label="NO SEAL" />
          <Stamp v-else kind="expired" label="EXPIRED" />
        </div>
        <div v-else-if="lookup?.status === 'valid'" class="my-4 sm:order-2 sm:my-0 sm:-mr-4 sm:-mt-2 sm:rotate-[-8deg]">
          <Stamp kind="registry" :size="150" />
        </div>

        <dl class="flex-1 pt-3">
          <ExtractRow label="Address"><AddressText v-if="lookup && lookup.status !== 'invalid'" :address="lookup.address" /><span v-else class="font-mono">{{ address }}</span></ExtractRow>
          <template v-if="sealed">
            <ExtractRow label="Organisation"><b>{{ lookup.seal.name }}</b></ExtractRow>
            <ExtractRow label="Jurisdiction">{{ country(lookup.seal.jurisdiction) }}</ExtractRow>
            <ExtractRow label="Subject">Legal entity</ExtractRow>
            <ExtractRow label="Sealed as">{{ ['Wallet', 'Program', 'Mint'][lookup.seal.kind] ?? lookup.seal.kind }}</ExtractRow>
            <ExtractRow label="Trust level">{{ lookup.seal.trustLevel === 1 ? 'On-chain: certificate and signature verified by the program' : 'Attested: signature checked off-chain by an attestor' }}</ExtractRow>
            <ExtractRow label="Confirmed by">
              <template v-if="lookup.trust">{{ lookup.trust.name }}, {{ lookup.trust.kind === 1 ? 'attestor' : 'certificate authority' }}, {{ lookup.trust.country }} </template>
              <span v-if="lookup.trustIsTest" class="ml-1 border border-refusal px-1 text-[12px] font-semibold text-refusal">TEST</span>
              <br><AddressText :address="lookup.seal.trustService" />
            </ExtractRow>
            <ExtractRow label="Valid">{{ date(lookup.seal.createdAt) }} to {{ date(lookup.seal.expiresAt) }}</ExtractRow>
            <ExtractRow label="Identifier hash"><span class="font-mono text-[13px]">{{ lookup.seal.identifierHash }}</span><br><span class="note">sha256(salt, jurisdiction, BIN or registry number); the salt stays with the owner, no personal data on-chain</span></ExtractRow>
            <ExtractRow label="Controller"><AddressText :address="lookup.seal.controller" /></ExtractRow>
            <ExtractRow label="Seal account"><AddressText :address="lookup.sealPda" /></ExtractRow>
            <ExtractRow v-if="lookup.seal.certificate !== ZERO_ADDRESS" label="Certificate"><AddressText :address="lookup.seal.certificate" /></ExtractRow>
            <ExtractRow label="Checked">slot {{ lookup.slot.toLocaleString('en-US') }}, {{ lookup.checkedAt.toLocaleTimeString('en-GB') }}</ExtractRow>
          </template>
          <template v-else-if="lookup?.status === 'none'">
            <p class="pt-3">No seal. The registry does not know who stands behind this address.</p>
          </template>
          <template v-else-if="lookup?.status === 'invalid'">
            <p class="pt-3">This is not a Solana address.</p>
          </template>
          <template v-else>
            <ExtractRow v-for="l in ['Organisation', 'Jurisdiction', 'Trust level', 'Confirmed by', 'Valid']" :key="l" :label="l"><span class="text-muted">…</span></ExtractRow>
          </template>
        </dl>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ZERO_ADDRESS, shortAddress } from '~/utils/registry'
import type { Lookup } from '~/composables/useRegistry'

const props = defineProps<{ address: string; lookup: Lookup | null }>()
const sealed = computed(() => props.lookup?.status === 'valid' || props.lookup?.status === 'expired')
const issued = computed(() => `Issued ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`)
const date = (s: bigint) => new Date(Number(s) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const names = new Intl.DisplayNames(['en'], { type: 'region' })
const country = (code: string) => { try { return `${names.of(code)} (${code})` } catch { return code } }
</script>
