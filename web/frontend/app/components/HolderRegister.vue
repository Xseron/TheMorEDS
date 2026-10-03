<template>
  <section class="card-white">
    <h2 class="h3">Register of bondholders as at {{ date }}</h2>
    <p class="note mt-1">Event {{ k }} · {{ completeness }}</p>
    <div class="mt-6 overflow-x-auto">
      <table class="w-full text-[15px]">
        <thead>
          <tr class="label text-left">
            <th class="pb-2 pr-4">Holder</th><th class="pb-2 pr-4">Bonds</th><th class="pb-2 pr-4">Coupon</th>
            <th class="pb-2 pr-4">Redeemed</th><th class="pb-2 pr-4">Principal</th><th class="pb-2 pr-4">Total</th><th class="pb-2">Payment</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in rows" :key="s.tokenAccount" class="border-t border-line align-top">
            <td class="py-3 pr-4">{{ names[s.owner] ?? '' }}<span class="block"><AddressText :address="s.owner" /></span></td>
            <td class="py-3 pr-4 font-mono">{{ s.balance }}</td>
            <td class="py-3 pr-4 font-mono">{{ formatTkzt(s.couponDue) }}</td>
            <td class="py-3 pr-4 font-mono">{{ s.redeemed }}</td>
            <td class="py-3 pr-4 font-mono">{{ formatTkzt(s.principalDue) }}</td>
            <td class="py-3 pr-4 font-mono">{{ formatTkzt(s.couponDue + s.principalDue) }}</td>
            <td class="py-3"><StatusBadge :text="s.paid ? 'Paid' : 'Due'" :tone="s.paid ? 'violet' : 'muted'" /></td>
          </tr>
        </tbody>
      </table>
      <p v-if="burned > 0n" class="note mt-3">{{ burned }} bonds were burned by holders since the previous event. The register is still complete: every row is processed</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { BondView } from '~/composables/useBond'
import { formatTkzt, recordTs } from '~/utils/bond'

const props = defineProps<{ view: BondView; k: number; names: Record<string, string> }>()
const event = computed(() => props.view.events.find(e => e.k === props.k))
const rows = computed(() => props.view.snapshots.filter(s => s.k === props.k && s.balance > 0n))
const date = computed(() => new Date(Number(recordTs(props.view.bond.terms, props.k)) * 1000).toLocaleTimeString('en-GB'))
const completeness = computed(() => {
  const e = event.value
  const required = props.view.bond.required[props.k - 1] ?? 0
  return `Holders processed ${e?.processed ?? 0} of ${required}: ${e?.complete ? 'complete' : 'in progress'}`
})
// Разница между ожидаемым остатком и суммой снимков: облигации, которые держатели сожгли сами
const burned = computed(() => {
  const e = event.value
  if (!e?.complete) return 0n
  const prev = props.view.events.find(p => p.k === props.k - 1)
  const expected = props.k === 1 ? props.view.bond.issued : prev ? prev.snapshotTotal - prev.redeemedTotal : e.snapshotTotal
  return expected > e.snapshotTotal ? expected - e.snapshotTotal : 0n
})
</script>
