<template>
  <section class="card-white">
    <h2 class="h3">Events</h2>
    <ol class="mt-4">
      <li v-for="k in ks" :key="k" class="grid items-start gap-x-6 gap-y-2 border-t border-line py-3 text-[15px] sm:grid-cols-[5rem_8rem_1fr_1fr]">
        <b>Event {{ k }}</b>
        <span><StatusBadge :text="label[status(k)]" :tone="status(k) === 'scheduled' ? 'muted' : 'violet'" /></span>
        <span><span class="label block">Record date</span>{{ time(recordTs(t, k)) }}<template v-if="now < recordTs(t, k)">, in {{ left(recordTs(t, k)) }}</template></span>
        <span><span class="label block">Payment</span>{{ time(paymentTs(t, k)) }}<template v-if="now < paymentTs(t, k)">, in {{ left(paymentTs(t, k)) }}</template></span>
        <span v-if="share(k)" class="font-bold text-violet sm:col-span-2 sm:col-start-3">{{ share(k) }}</span>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import type { BondView } from '~/composables/useBond'
import { eventStatus, paymentTs, recordTs, type EventStatus } from '~/utils/bond'

const props = defineProps<{ view: BondView; now: bigint }>()
const t = computed(() => props.view.bond.terms)
const ks = computed(() => Array.from({ length: t.value.nEvents }, (_, i) => i + 1))
const label: Record<EventStatus, string> = { scheduled: 'Scheduled', recording: 'Recording', complete: 'Complete', funded: 'Funded', paid: 'Paid' }
const status = (k: number) => eventStatus(t.value, props.view.events.find(e => e.k === k), k, props.now)
const share = (k: number) => {
  if (k === t.value.nEvents) return 'Redemption of all bonds'
  const bps = props.view.events.find(e => e.k === k)?.redemptionBps ?? 0
  return bps ? `Partial redemption ${bps / 100}%` : ''
}
const time = (s: bigint) => new Date(Number(s) * 1000).toLocaleTimeString('en-GB')
function left(s: bigint) {
  const d = Number(s - props.now)
  return d >= 60 ? `${Math.floor(d / 60)}m ${d % 60}s` : `${d}s`
}
</script>
