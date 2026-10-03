<template>
  <div class="mx-auto max-w-[760px]">
    <h1 class="mb-3 text-[28px]">Seal your wallet</h1>
    <p class="mb-8">A seal ties your wallet to your company. The company name and a salted hash of its BIN go on-chain. The BIN itself does not.</p>

    <ClientOnly>
      <ol class="space-y-8">
        <li>
          <h2 class="mb-2 text-[22px]">1. Wallet</h2>
          <WalletButton v-if="!wallet" />
          <template v-else>
            <p>Connected: <AddressText :address="wallet.address" /> ({{ wallet.name }})</p>
            <p v-if="existing === undefined && !error" class="note">Checking the registry…</p>
            <div v-else-if="existing" class="mt-2 flex flex-wrap items-center gap-3 border border-seal p-3">
              <span>This wallet is already sealed as <b>{{ existing.seal.name }}</b>. <NuxtLink :to="`/address/${wallet.address}`">Open the extract</NuxtLink>.</span>
              <RevokeButton :address="wallet.address" :seal-pda="existing.sealPda" @revoked="onRevoked" />
            </div>
            <p v-if="revoked" class="mt-2 border border-seal p-3">Seal revoked. Transaction: <a :href="txLink(revoked)" target="_blank" rel="noopener" class="font-mono text-[13px]">{{ revoked }}</a></p>
          </template>
        </li>

        <li v-if="wallet && existing === null && !done">
          <h2 class="mb-2 text-[22px]">2. Attestation</h2>
          <div class="mb-3 flex flex-wrap gap-5">
            <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="nca"> NCA of Kazakhstan (NCALayer)</label>
            <label class="flex items-center gap-2"><input v-model="mode" type="radio" value="test"> Test attestor (demo)</label>
          </div>

          <fieldset v-if="mode === 'nca'" class="space-y-3 border border-rule p-4">
            <legend class="px-1">NCA of Kazakhstan</legend>
            <p class="text-[15px]">This is the request you sign with your company's NCA key. The attestor reads the company name and BIN from your certificate.</p>
            <pre class="overflow-x-auto border border-rule bg-seal-tint p-3 font-mono text-[13px]">{{ request.text }}</pre>
            <button class="btn btn-primary" :disabled="busy" @click="attestNca">Sign with NCALayer</button>
            <span v-if="busy" class="note ml-3">{{ stage }}</span>
          </fieldset>

          <fieldset v-else class="space-y-3 border border-rule p-4">
            <legend class="px-1">Test attestor (demo)</legend>
            <p class="border border-refusal p-2 text-[15px] text-refusal">The attestor key is public. Anyone can mint such seals. Demo only.</p>
            <label class="block">Company name<input v-model="name" class="field mt-1" maxlength="128"></label>
            <label class="block">BIN<input v-model="bin" class="field mt-1" inputmode="numeric" maxlength="12"></label>
            <button class="btn btn-primary" :disabled="busy" @click="attestTest">Sign with the test attestor</button>
          </fieldset>

          <p v-if="attestation" class="mt-3 border border-seal p-3">
            Attested by <AddressText :address="attestation.trustService" />: <b>{{ attestation.name }}</b><span v-if="attestation.bin">, BIN {{ attestation.bin }}</span>.
            The BIN stays in this browser and does not go on-chain.
          </p>
        </li>

        <li v-if="attestation && !done">
          <h2 class="mb-2 text-[22px]">3. Register</h2>
          <button class="btn btn-primary" :disabled="busy" @click="register">Register seal</button>
          <span v-if="busy" class="note ml-3">Simulating and sending…</span>
        </li>

        <li v-if="done">
          <h2 class="mb-2 text-[22px]">Seal registered</h2>
          <div class="border border-seal p-4">
            <p><b>{{ done.name }}</b>, KZ, attested, valid until {{ date(done.expiresAt) }}.</p>
            <p>Extract: <NuxtLink :to="`/address/${wallet!.address}`">open</NuxtLink>. Transaction: <a :href="txLink(done.sig)" target="_blank" rel="noopener" class="font-mono text-[13px]">{{ done.sig }}</a></p>
            <p class="mt-3">Salt: <code class="font-mono text-[13px]">{{ done.salt }}</code>
              <button class="btn ml-2" @click="copySalt">{{ saltCopied ? 'Copied' : 'Copy salt' }}</button></p>
            <p class="note">Keep it. You need it to disclose your BIN to a counterparty. It is not stored anywhere else.</p>
          </div>
        </li>
      </ol>
      <p v-if="error" class="mt-4 border border-refusal p-3 text-refusal">{{ error }}</p>
      <button v-if="error && existing === undefined" class="btn mt-2" @click="check">Retry</button>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { attestWithTestKey, postAttest, registerInstructions, requestText, verifyAttestation, type Attestation } from '~/utils/attestation'
import { describeError } from '~/utils/errors'
import { signWithNcaLayer } from '~/utils/ncalayer'
import { hex, sealPda } from '~/utils/registry'
import type { Lookup } from '~/composables/useRegistry'

useSeoMeta({ title: 'Seal your wallet with an electronic signature', description: 'Register a MOR seal for your Solana wallet through the NCA of Kazakhstan or the test attestor.' })

const { ids, send, accountData, txLink, attestorUrl, attestorAddress, testAttestorKey } = useSolana()
const { wallet } = useWallet()
const { lookup, invalidate } = useRegistry()

type Sealed = Extract<Lookup, { status: 'valid' | 'expired' }>
const existing = ref<Sealed | null | undefined>(undefined)
const revoked = ref('')
const name = ref('Demo LLP')
const bin = ref('123456789012')
const attestation = ref<Attestation | null>(null)
const busy = ref(false)
const error = ref('')
const done = ref<{ sig: string; salt: string; name: string; expiresAt: bigint } | null>(null)
const saltCopied = ref(false)
const now = () => BigInt(Math.floor(Date.now() / 1000))
const date = (s: bigint) => new Date(Number(s) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const mode = ref<'nca' | 'test'>('nca')
const stage = ref('')
// Текст запроса фиксируется при показе: пользователь подписывает ровно то, что видит
const request = ref({ text: '', expires: 0n, deadline: 0n })
watch([mode, () => wallet.value?.address], () => {
  if (mode.value === 'nca' && wallet.value) request.value = requestText(ids, wallet.value.address, now())
}, { immediate: true })

async function check() {
  existing.value = undefined
  attestation.value = null
  done.value = null
  error.value = ''
  if (!wallet.value) return
  const addr = wallet.value.address
  try {
    const r = await lookup(addr, true)
    // Ответ по уже сменённому кошельку не показываем
    if (wallet.value?.address === addr) existing.value = r.status === 'valid' || r.status === 'expired' ? r : null
  } catch (e) {
    if (wallet.value?.address === addr) error.value = describeError(e, { attestorUrl })
  }
}
// Баннер отзыва принадлежит кошельку, а не проверке: после отзыва check() вызывается снова, и баннер должен остаться
watch(() => wallet.value?.address, () => { revoked.value = ''; check() }, { immediate: true })

function onRevoked(sig: string) {
  revoked.value = sig
  check()
}

async function attestTest() {
  error.value = ''
  busy.value = true
  try {
    attestation.value = await attestWithTestKey(ids, testAttestorKey, wallet.value!.address, name.value.trim(), bin.value.trim(), now())
  } catch (e) {
    error.value = describeError(e, { attestorUrl })
  } finally {
    busy.value = false
  }
}

async function attestNca() {
  error.value = ''
  busy.value = true
  try {
    stage.value = 'Waiting for NCALayer…'
    const cms = await signWithNcaLayer(request.value.text)
    stage.value = 'Asking the attestor…'
    attestation.value = await postAttest(attestorUrl, cms)
  } catch (e) {
    error.value = describeError(e, { attestorUrl })
  } finally {
    busy.value = false
    stage.value = ''
  }
}

async function register() {
  error.value = ''
  busy.value = true
  try {
    const a = attestation.value!
    const owner = wallet.value!.address
    await verifyAttestation(ids, a, owner, attestorAddress, now())
    if (!(await accountData(a.trustService))) throw new Error('The attestor is not registered in this registry')
    const sig = await send(registerInstructions(ids, a, owner, await sealPda(ids, owner)))
    invalidate(owner)
    done.value = { sig, salt: hex(a.salt), name: a.name, expiresAt: a.expiresAt }
    revoked.value = ''
  } catch (e) {
    error.value = describeError(e, { attestorUrl })
  } finally {
    busy.value = false
  }
}

async function copySalt() {
  try { await navigator.clipboard.writeText(done.value!.salt); saltCopied.value = true } catch { /* ссылка на выписку рядом, соль видна текстом */ }
}
</script>
