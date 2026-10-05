<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <figure class="card">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <figcaption>Transfers of a state-issued token in Alatau City. <span class="note">Example data</span></figcaption>
      <!-- Настоящие радиокнопки под прозрачным слоем, как на /seal -->
      <div role="radiogroup" aria-label="Ledger view" class="flex flex-wrap gap-2">
        <label class="btn relative" :class="{ 'btn-primary': !withSeals }"><input v-model="withSeals" type="radio" name="ledger-view" :value="false" class="toggle">Without seals</label>
        <label class="btn relative" :class="{ 'btn-primary': withSeals }"><input v-model="withSeals" type="radio" name="ledger-view" :value="true" class="toggle">With seals</label>
      </div>
    </div>
    <div class="mt-6 overflow-x-auto rounded-control bg-paper">
      <table class="w-full min-w-[44rem] text-[15px]">
        <thead>
          <tr class="label">
            <th class="px-5 pb-3 pt-5 text-left">Date</th>
            <th class="px-5 pb-3 pt-5 text-left">Payer</th>
            <th class="px-5 pb-3 pt-5 text-left">Payee</th>
            <th class="px-5 pb-3 pt-5 text-right">Amount</th>
            <th class="px-5 pb-3 pt-5 text-left">Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.date + r.purpose" class="border-t border-line align-top">
            <td class="whitespace-nowrap px-5 py-4 tabular-nums">{{ r.date }}</td>
            <td class="px-5 py-4"><Party :side="r.payer" :sealed="withSeals" /></td>
            <td class="px-5 py-4"><Party :side="r.payee" :sealed="withSeals" /></td>
            <td class="whitespace-nowrap px-5 py-4 text-right tabular-nums">{{ r.amount }}</td>
            <td class="px-5 py-4">{{ r.purpose }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </figure>
</template>

<script setup lang="ts">
import { defineComponent, h, type PropType } from 'vue'

// name: null, если у кошелька нет печати
type Side = { address: string; name: string | null }
const B: Side = { address: 'Bp75…eALw', name: 'ТОО «Ромашка»' }
const A: Side = { address: 'DERF…5GmF', name: 'Acme Robotics OÜ' }
const build: Side = { address: '7kF3…9xQ2', name: 'Alatau Build LLP' }
const unknown: Side = { address: '3nVp…aL9e', name: null }
const rows = [
  { date: '2027-03-02', payer: B, payee: build, amount: '48,000,000', purpose: 'Office purchase, block 4' },
  { date: '2027-03-02', payer: unknown, payee: build, amount: '52,500,000', purpose: 'Office purchase, block 7' },
  { date: '2027-03-03', payer: build, payee: A, amount: '1,200,000', purpose: 'Building automation' },
  { date: '2027-03-04', payer: A, payee: B, amount: '300,000', purpose: 'Consulting' },
]
const withSeals = ref(false)

// key меняется вместе с режимом, span пересоздаётся и проигрывает смену прозрачности
const Party = defineComponent({
  props: { side: { type: Object as PropType<Side>, required: true }, sealed: Boolean },
  setup: props => () => {
    const addr = h('span', { class: 'block whitespace-nowrap font-mono text-[14px]' + (props.sealed ? ' text-muted' : '') }, props.side.address)
    if (!props.sealed) return h('span', { key: 'plain', class: 'party block' }, [addr])
    const name = props.side.name
      ? h('b', { class: 'block' }, props.side.name)
      : h('b', { class: 'block text-refusal' }, 'no seal')
    return h('span', { key: 'sealed', class: 'party block' }, [name, addr])
  },
})
</script>

<style scoped>
.toggle { @apply absolute inset-0 cursor-pointer appearance-none rounded-control; }
.toggle:focus-visible { outline-offset: 4px; }
.party { animation: appear 200ms ease-out both; }
@keyframes appear { from { opacity: 0.2; } to { opacity: 1; } }
</style>
