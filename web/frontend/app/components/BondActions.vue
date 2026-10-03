<template>
  <section class="card-white">
    <h2 class="h3">Actions</h2>
    <div class="mt-4 flex flex-wrap gap-2">
      <button v-if="isIssuer && announceK" class="btn" :disabled="busy" @click="announce">Announce 30% redemption</button>
      <button v-if="pendingK" class="btn btn-primary" :disabled="busy || pendingRows.length === 0" @click="snapshots">Take snapshots for event {{ pendingK }}</button>
      <button v-if="isIssuer && fundK" class="btn" :disabled="busy" @click="faucet">Get tKZT</button>
      <button v-if="isIssuer && fundK" class="btn" :disabled="busy" @click="fund">Fund event {{ fundK }}</button>
      <button v-if="payK" class="btn btn-primary" :disabled="busy || unpaid.length === 0 || now < paymentTs(t, payK)" @click="payAll">Pay all for event {{ payK }}</button>
    </div>
    <div v-if="investors.length === 3" class="mt-3 flex flex-wrap gap-2">
      <button class="btn" :disabled="busy" @click="transfer(1)">Send 1 bond: Investor 1 → Investor 2</button>
      <button class="btn" :disabled="busy" @click="transfer('c')">Send 1 bond to C (no seal)</button>
    </div>
    <p class="note mt-3">Anyone can send snapshots and payments, and the program checks the rules. Only the issuer announces a redemption and funds an event</p>
    <p v-if="busy" class="note mt-4">Simulating first, then sending</p>

    <div v-else-if="result" class="mt-6 border-t border-line pt-5">
      <SealStatus v-if="result.rejected" status="rejected" class="mb-4" />
      <b class="h3 block" :class="{ 'text-refusal': !result.ok && !result.rejected }">{{ result.title }}</b>
      <p class="mt-1">{{ result.text }}</p>
      <p v-if="result.sig" class="mt-3 font-mono text-[13px] [overflow-wrap:anywhere]">Transaction: <a :href="txLink(result.sig)" target="_blank" rel="noopener">{{ result.sig }}</a></p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { createNoopSigner, type Address, type Instruction } from '@solana/kit'
import type { BondView } from '~/composables/useBond'
import { ata2022, createAta2022Instruction, eventsRecorded, noticeDeadline, paymentTs, transferBondInstruction } from '~/utils/bond'
import {
  getAnnounceRedemptionInstructionAsync, getFaucetInstructionAsync, getFundInstructionAsync, getPayInstructionAsync, getTakeSnapshotInstructionAsync,
} from '~/utils/bond/generated'
import { describeError, isHookRejection } from '~/utils/errors'
import { DEMO } from '~/utils/registry'
import { submit, type Wallet } from '~/utils/submit'

const props = defineProps<{ view: BondView; mint: Address; now: bigint; names: Record<string, string> }>()
const emit = defineEmits<{ changed: [] }>()

const solana = useSolana()
const { rpc, ids, bondProgram, tkztMint, txLink, attestorUrl } = solana
const { wallet } = useWallet()
const { load: loadInvestors } = useInvestors()
const investors = ref<Wallet[]>([])
const busy = ref(false)
const result = ref<{ ok: boolean; title: string; text: string; sig?: string; rejected?: boolean } | null>(null)
const cfg = { programAddress: bondProgram }

const t = computed(() => props.view.bond.terms)
const isIssuer = computed(() => wallet.value?.address === props.view.bond.issuer)
const kClock = computed(() => eventsRecorded(t.value, props.now))
const event = (k: number) => props.view.events.find(e => e.k === k)
// Самое раннее наступившее событие, которое ещё не полное
const pendingK = computed(() => { for (let k = 1; k <= kClock.value; k++) if (!event(k)?.complete) return k; return 0 })
const pendingRows = computed(() => props.view.rows.filter(r => r.lastEvent === pendingK.value - 1))
const announceK = computed(() => (event(2)?.redemptionBps || props.now > noticeDeadline(t.value, 2) ? 0 : 2))
const fundK = computed(() => props.view.events.find(e => e.complete && e.funded === 0n && e.couponTotal + e.principalTotal > 0n)?.k ?? 0)
const payK = computed(() => props.view.events.find(e => e.complete && e.funded === e.couponTotal + e.principalTotal && e.paid < e.funded)?.k ?? 0)
const unpaid = computed(() => props.view.snapshots.filter(s => s.k === payK.value && !s.paid && s.balance > 0n))

onMounted(async () => {
  // Кнопки инвесторов только для облигаций, выпущенных в этом браузере
  try {
    const mine = JSON.parse(localStorage.getItem('kase-bonds') ?? '[]') as string[]
    if (mine.includes(props.mint)) investors.value = await loadInvestors()
  } catch { /* хранилище закрыто */ }
})

async function run(title: string, fn: () => Promise<string>, okText: string) {
  busy.value = true
  result.value = null
  try {
    const sig = await fn()
    result.value = { ok: true, title, text: okText, sig }
  } catch (e) {
    const rejected = isHookRejection(e)
    result.value = { ok: false, title: rejected ? 'Transfer rejected' : 'Action failed', text: describeError(e, { attestorUrl }), rejected }
  } finally {
    busy.value = false
    emit('changed')
  }
}

const me = () => createNoopSigner(wallet.value!.address)

const announce = () => run('Redemption announced', async () =>
  solana.send([await getAnnounceRedemptionInstructionAsync({ issuer: me(), mint: props.mint, k: 2, bps: 3_000 }, cfg)]),
'Event 2 will redeem 30% of each holding, rounded down to whole bonds.')

const snapshots = () => run(`Event ${pendingK.value} snapshotted`, async () => {
  const k = pendingK.value
  const ixs = await Promise.all(pendingRows.value.map(r => getTakeSnapshotInstructionAsync({ payer: me(), mint: props.mint, tokenAccount: r.tokenAccount, k }, cfg)))
  return solana.send(ixs)
}, 'Balances at the record date are fixed. Redeemed bonds are burned.')

const faucet = () => run('tKZT received', async () => {
  const dest = await ata2022(wallet.value!.address, tkztMint)
  return solana.send([
    createAta2022Instruction(wallet.value!.address, dest, wallet.value!.address, tkztMint),
    await getFaucetInstructionAsync({ payer: me(), paymentMint: tkztMint, destination: dest, amount: 5_000_000n }, cfg),
  ])
}, 'The faucet stands in for the tenge sent to the paying agent.')

const fund = () => run(`Event ${fundK.value} funded`, async () => solana.send([await getFundInstructionAsync({
  issuer: me(), mint: props.mint, paymentMint: tkztMint, source: await ata2022(wallet.value!.address, tkztMint), vault: props.view.bond.vault, k: fundK.value,
}, cfg)]), 'The vault holds exactly what the event owes.')

const payAll = () => run(`Event ${payK.value} paid`, async () => {
  const k = payK.value
  const ixs: Instruction[] = []
  for (const s of unpaid.value) {
    const dest = await ata2022(s.owner, tkztMint)
    ixs.push(createAta2022Instruction(wallet.value!.address, dest, s.owner, tkztMint))
    ixs.push(await getPayInstructionAsync({ payer: me(), mint: props.mint, tokenAccount: s.tokenAccount, paymentMint: tkztMint, vault: props.view.bond.vault, destination: dest, k }, cfg))
  }
  return solana.send(ixs)
}, 'Each holder at the record date received the amount from their snapshot.')

const transfer = (to: 1 | 'c') => run('Transfer passed', async () => {
  const from = investors.value[0]!
  const destOwner: Address = to === 'c' ? DEMO.c : investors.value[1]!.address
  const [source, destination] = await Promise.all([ata2022(from.address, props.mint), ata2022(destOwner, props.mint)])
  return submit(rpc, from, [
    createAta2022Instruction(from.address, destination, destOwner, props.mint),
    await transferBondInstruction(bondProgram, ids.registry, props.mint, { source, destination, destinationOwner: destOwner, authority: from.address, amount: 1n }),
  ])
}, 'The hook found both register rows snapshotted and the recipient sealed.')
</script>
