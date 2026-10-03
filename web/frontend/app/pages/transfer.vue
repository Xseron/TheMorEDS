<template>
  <div class="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
    <header>
      <h1>Sealed transfer</h1>
      <p class="mt-5 text-muted">A Token-2022 token with a transfer hook. A transfer goes through only when the recipient's wallet carries a seal of trust level "attested" or higher. The hook reads the registry on every transfer.</p>
    </header>

    <div class="band -mx-5 space-y-4 rounded-none p-5 sm:mx-0 sm:rounded-card md:p-10 lg:self-start">
      <ClientOnly>
        <div v-if="!wallet" class="card-white">
          <p>Connect a wallet to send the demo token.</p>
          <WalletButton class="mt-4" />
        </div>
        <template v-else>
          <div class="card-white">
            <p>Sender: <AddressText :address="wallet.address" />, balance: <b>{{ balance ?? '…' }}</b> tokens</p>

            <div v-if="empty" class="mt-5 rounded-card border border-coral/60 bg-coral/10 p-5 text-[15px]">
              <p><b>This wallet is empty.</b> Fund it from WSL with devnet SOL and tokens from the issuer. SOL is also available at <a href="https://faucet.solana.com" target="_blank" rel="noopener">faucet.solana.com</a>; only the issuer can mint the token.</p>
              <pre class="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere]">solana transfer -u devnet {{ wallet.address }} 0.3 --allow-unfunded-recipient
spl-token -u devnet create-account {{ ids.mint }} --owner {{ wallet.address }} -p TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb --fee-payer ~/.config/solana/id.json
spl-token -u devnet mint {{ ids.mint }} 50 {{ ownAta }}</pre>
              <p class="note mt-3">Judges: ask <a href="https://t.me/dtorossyan" target="_blank" rel="noopener">@dtorossyan</a> on Telegram for demo tokens.</p>
            </div>

            <div class="mt-6 grid gap-2">
              <button class="btn" :disabled="busy" @click="send(DEMO.a)">Send 1 token to A (EU)</button>
              <button class="btn" :disabled="busy" @click="send(DEMO.b)">Send 1 token to B (Kazakhstan)</button>
              <button class="btn" :disabled="busy" @click="send(DEMO.c)">Send 1 token to C (no seal)</button>
            </div>
            <form class="mt-3 flex flex-wrap gap-2" @submit.prevent="send(custom)">
              <label class="sr-only" for="to">Recipient address</label>
              <input id="to" v-model="custom" class="field min-w-0 flex-1 basis-60 font-mono" placeholder="recipient address">
              <button class="btn btn-primary max-sm:w-full" :disabled="busy">Send 1 token</button>
            </form>
            <p v-if="busy" class="note mt-4">Simulating and sending…</p>
          </div>

          <div v-if="result && !busy" class="card-white">
            <SealStatus v-if="result.rejected" status="rejected" class="mb-4" />
            <b class="h3 block" :class="{ 'text-refusal': !result.ok && !result.rejected }">{{ result.ok ? 'Transfer passed' : result.rejected ? 'Transfer rejected' : 'Transfer failed' }}</b>
            <p class="mt-1">{{ result.text }}</p>
            <p v-if="result.sig" class="mt-3 font-mono text-[13px] [overflow-wrap:anywhere]">Transaction: <a :href="txLink(result.sig)" target="_blank" rel="noopener">{{ result.sig }}</a></p>
          </div>
        </template>
        <template #fallback>
          <div class="card-white"><span class="block h-6 w-48 animate-pulse rounded bg-lilac-soft" /></div>
        </template>
      </ClientOnly>

      <section class="card-white">
        <h2 class="h3">Holders</h2>
        <p class="note mt-2">The public devnet RPC does not allow listing holders, so this is the fixed list of demo wallets plus the connected one and the address in the field above.</p>
        <button class="btn mt-4" :disabled="holdersBusy" @click="loadHolders">Show holders</button>
        <div v-if="holders.length" class="mt-6 overflow-x-auto">
          <table class="w-full text-[15px]">
            <thead><tr class="label text-left"><th class="pb-2 pr-4">Owner</th><th class="pb-2 pr-4">Balance</th><th class="pb-2">Who stands behind the address</th></tr></thead>
            <tbody>
              <tr v-for="h in holders" :key="h.owner" class="border-t border-line align-top">
                <td class="py-3 pr-4"><AddressText :address="h.owner" /><span v-if="h.tag" class="note block">({{ h.tag }})</span></td>
                <td class="py-3 pr-4 font-mono">{{ h.balance }}</td>
                <td class="py-3"><span v-if="h.seal">{{ h.seal }}</span><span v-else class="text-refusal">no seal</span></td>
              </tr>
            </tbody>
          </table>
          <p class="note mt-3">Wallets: {{ holders.length }}, with a valid seal: {{ holders.filter(h => h.valid).length }}</p>
        </div>
      </section>
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
defineOgImageComponent('Default', { title: 'Sealed transfer demo on Solana devnet', description: 'Send a Token-2022 demo token whose transfer hook checks the recipient\'s MOR seal on every transfer.' })

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
