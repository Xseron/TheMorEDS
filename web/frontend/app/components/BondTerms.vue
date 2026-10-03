<template>
  <section class="card-white" aria-live="polite">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <StatusBadge :text="redeemedAll ? 'Redeemed' : 'Active'" :tone="redeemedAll ? 'muted' : 'violet'" />
      <AddressText :address="mint" />
    </header>
    <h2 class="mt-5">{{ issuerName || (issuerNoSeal ? 'Issuer without a seal' : shortAddress(view.bond.issuer)) }}</h2>
    <p class="mt-1 text-muted">Bond · {{ t.couponRateBps / 100 }}% coupon · {{ t.nEvents }} events · Solana devnet</p>
    <dl class="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
      <ExtractRow label="Face value">{{ formatTkzt(t.face) }}</ExtractRow>
      <ExtractRow label="Coupon">{{ t.couponRateBps / 100 }}% a year, paid {{ t.paymentsPerYear }} times a year</ExtractRow>
      <ExtractRow label="Schedule">{{ t.nEvents }} events, one every {{ Number(t.periodSecs) / 60 }} min in this demo</ExtractRow>
      <ExtractRow label="Issued">{{ view.bond.issued }} bonds</ExtractRow>
      <ExtractRow label="Outstanding">{{ view.bond.outstanding }} bonds, token supply {{ view.supply }}</ExtractRow>
      <ExtractRow label="Vault">{{ formatTkzt(view.vaultBalance) }}</ExtractRow>
      <ExtractRow label="Issuer"><AddressText :address="view.bond.issuer" /></ExtractRow>
      <ExtractRow label="Cluster time">{{ clock }}</ExtractRow>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { BondView } from '~/composables/useBond'
import { formatTkzt } from '~/utils/bond'
import { shortAddress } from '~/utils/registry'

const props = defineProps<{ view: BondView; mint: string; issuerName?: string; issuerNoSeal?: boolean }>()
const t = computed(() => props.view.bond.terms)
const redeemedAll = computed(() => props.view.bond.issued > 0n && props.view.bond.outstanding === 0n && props.view.supply === 0n)
const clock = computed(() => new Date(Number(props.view.now) * 1000).toLocaleTimeString('en-GB'))
</script>
