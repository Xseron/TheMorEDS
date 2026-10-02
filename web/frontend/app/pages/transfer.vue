<template>
  <div class="mx-auto max-w-[760px]">
    <h1 class="mb-3 text-[28px]">Sealed transfer</h1>
    <p class="mb-6">A Token-2022 token with a transfer hook. A transfer goes through only when the recipient's wallet carries a seal of trust level "attested" or higher. The hook reads the registry on every transfer.</p>

    <ClientOnly>
      <div v-if="!wallet" class="border border-rule p-4">
        <p class="mb-3">Connect a wallet to send the demo token.</p>
        <WalletButton />
      </div>
      <template v-else>
        <p>Sender: <AddressText :address="wallet.address" />, balance: <b>{{ balance ?? '…' }}</b> tokens</p>

        <div v-if="empty" class="my-4 border border-refusal p-4 text-[15px]">
          <p class="mb-2"><b>This wallet is empty.</b> Fund it from WSL with devnet SOL and tokens from the issuer. SOL is also available at <a href="https://faucet.solana.com" target="_blank" rel="noopener">faucet.solana.com</a>; only the issuer can mint the token.</p>
          <pre class="overflow-x-auto whitespace-pre-wrap font-mono text-[13px]">solana transfer -u devnet {{ wallet.address }} 0.3 --allow-unfunded-recipient
spl-token -u devnet create-account {{ ids.mint }} --owner {{ wallet.address }} -p TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb --fee-payer ~/.config/solana/id.json
spl-token -u devnet mint {{ ids.mint }} 50 {{ ownAta }}</pre>
        </div>

        <div class="my-4 flex flex-wrap gap-2">
          <button class="btn" :disabled="busy" @click="send(DEMO.a)">Send 1 token to A (EU)</button>
          <button class="btn" :disabled="busy" @click="send(DEMO.b)">Send 1 token to B (Kazakhstan)</button>
          <button class="btn" :disabled="busy" @click="send(DEMO.c)">Send 1 token to C (no seal)</button>
        </div>
        <form class="flex flex-wrap gap-2" @submit.prevent="send(custom)">
          <label class="sr-only" for="to">Recipient address</label>
          <input id="to" v-model="custom" class="field flex-1" placeholder="recipient address">
          <button class="btn btn-primary" :disabled="busy">Send 1 token</button>
        </form>

        <p v-if="busy" class="note mt-4">Simulating and sending…</p>
        <div v-else-if="result" class="mt-4 flex items-start gap-4 border p-4" :class="result.ok ? 'border-seal' : 'border-refusal'">
          <Stamp v-if="result.rejected" kind="refused" label="REJECTED" :size="110" />
          <div>
            <b>{{ result.ok ? 'Transfer passed' : result.rejected ? 'Transfer rejected' : 'Transfer failed' }}</b>
            <p>{{ result.text }}</p>
            <p v-if="result.sig" class="font-mono text-[13px]">Transaction: <a :href="txLink(result.sig)" target="_blank" rel="noopener">{{ result.sig }}</a></p>
          </div>
        </div>
      </template>
    </ClientOnly>

    <h2 class="mb-2 mt-10 text-[22px]">Holders</h2>
    <p class="note mb-3">The public devnet RPC does not allow listing holders, so this is the fixed list of demo wallets plus the connected one and the address in the field above.</p>
    <button class="btn" :disabled="holdersBusy" @click="loadHolders">Show holders</button>
    <div v-if="holders.length" class="mt-4 overflow-x-auto">
      <table class="w-full text-[15px]">
        <thead><tr class="border-b border-ink text-left"><th class="py-1 pr-3">Owner</th><th class="py-1 pr-3">Balance</th><th class="py-1">Who stands behind the address</th></tr></thead>
        <tbody>
          <tr v-for="h in holders" :key="h.owner" class="border-b border-rule align-top">
            <td class="py-1 pr-3"><AddressText :address="h.owner" /><span v-if="h.tag" class="note"> ({{ h.tag }})</span></td>
            <td class="py-1 pr-3 font-mono">{{ h.balance }}</td>
            <td class="py-1"><span v-if="h.seal">{{ h.seal }}</span><span v-else class="text-refusal">no seal</span></td>
          </tr>
        </tbody>
      </table>
      <p class="note mt-2">Wallets: {{ holders.length }}, with a valid seal: {{ holders.filter(h => h.valid).length }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Address } from '@solana/kit'
import { describeError, isHookRejection } from '~/utils/errors'
import {
  DEMO, ataOf, createAtaIdempotentInstruction, decodeSeal, extraMetasPda, parseAddress, policyPda, sealPda, transferCheckedInstruction,
} from '~/utils/registry'

useSeoMeta({ title: 'Sealed transfer demo on Solana devnet', description: 'Send a Token-2022 demo token whose transfer hook checks the recipient\'s MOR seal on every transfer.' })

const solana = useSolana()
const { rpc, ids, txLink, attestorUrl } = solana
const { wallet } = useWallet()

const balance = ref<string | null>(null)
const sol = ref(0)
const ownAta = ref('')
const custom = ref('')
const busy = ref(false)
const result = ref<{ ok: boolean; text: string; sig?: string; rejected?: boolean } | null>(null)
const empty = computed(() => balance.value !== null && (sol.value < 0.001 || balance.value === '0'))

async function refresh() {
  if (!wallet.value) return
  const owner = wallet.value.address
  const ata = await ataOf(ids, owner)
  ownAta.value = ata
  const [tokens, lamports] = await Promise.all([
    rpc.getTokenAccountBalance(ata).send().then(r => r.value.uiAmountString ?? '0').catch(() => '0'),
    rpc.getBalance(owner).send().then(r => Number(r.value) / 1e9).catch(() => 0),
  ])
  if (wallet.value?.address !== owner) return // кошелёк сменили, пока ждали RPC
  balance.value = tokens
  sol.value = lamports
}
watch(() => wallet.value?.address, () => { balance.value = null; result.value = null; refresh() }, { immediate: true })

async function send(to: string) {
  const dest = parseAddress(to)
  if (!dest) { result.value = { ok: false, text: 'This is not a Solana address' }; return }
  busy.value = true
  result.value = null
  try {
    const from = wallet.value!.address
    const [source, destination, policy, recipientSeal, extraMetas] = await Promise.all([ataOf(ids, from), ataOf(ids, dest), policyPda(ids), sealPda(ids, dest), extraMetasPda(ids)])
    const sig = await solana.send([
      createAtaIdempotentInstruction(ids, from, destination, dest),
      transferCheckedInstruction(ids, { source, destination, authority: from, amount: 1n, policy, recipientSeal, extraMetas }),
    ])
    result.value = { ok: true, text: 'The hook found the recipient\'s seal and let the transfer through.', sig }
  } catch (e) {
    result.value = { ok: false, text: describeError(e, { attestorUrl }), rejected: isHookRejection(e) }
  } finally {
    busy.value = false
    refresh()
  }
}

type Holder = { owner: string; tag: string; balance: string; seal: string | null; valid: boolean }
const holders = ref<Holder[]>([])
const holdersBusy = ref(false)

async function loadHolders() {
  holdersBusy.value = true
  try {
    const owners = new Map<Address, string>([[DEMO.issuer, 'issuer'], [DEMO.a, ''], [DEMO.b, ''], [DEMO.c, '']])
    if (wallet.value) owners.set(wallet.value.address, wallet.value.name)
    const extra = parseAddress(custom.value)
    if (extra && !owners.has(extra)) owners.set(extra, '')
    const list = [...owners.keys()]
    const [atas, seals] = await Promise.all([Promise.all(list.map(o => ataOf(ids, o))), Promise.all(list.map(o => sealPda(ids, o)))])
    const [accounts, sealAccounts] = await Promise.all([solana.accountsData(atas), solana.accountsData(seals)])
    const now = BigInt(Math.floor(Date.now() / 1000))
    holders.value = list.map((owner, i) => {
      const acc = accounts[i]
      const balance = acc ? new DataView(acc.buffer, acc.byteOffset).getBigUint64(64, true).toString() : 'no account'
      let seal: string | null = null
      let valid = false
      if (sealAccounts[i]) {
        const s = decodeSeal(sealAccounts[i]!)
        valid = s.expiresAt >= now
        seal = `${s.name}, ${s.jurisdiction}, ${s.trustLevel === 1 ? 'on-chain' : 'attested'}${valid ? '' : ' (expired)'}`
      }
      return { owner, tag: owners.get(owner) ?? '', balance, seal, valid }
    })
  } finally {
    holdersBusy.value = false
  }
}
</script>
