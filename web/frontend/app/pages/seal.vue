<template>
  <div class="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
    <header>
      <h1>Seal your wallet</h1>
      <p class="mt-5 text-muted">A seal ties your wallet to your company. The company name and a salted hash of its BIN go on-chain. The BIN itself does not.</p>
    </header>

    <div class="band -mx-5 rounded-none p-5 sm:mx-0 sm:rounded-card md:p-10 lg:self-start">
      <ClientOnly>
        <ol class="space-y-4">
          <li class="card-white">
            <h2 class="h3">1. Wallet</h2>
            <WalletButton v-if="!wallet" class="mt-4" />
            <template v-else>
              <p class="mt-3">Connected: <AddressText :address="wallet.address" /> ({{ wallet.name }})</p>
              <p v-if="existing === undefined && !error" class="note mt-2">Checking the registry…</p>
              <div v-else-if="existing" class="mt-5 rounded-control bg-lilac-soft p-4">
                <p>This wallet is already sealed as <b>{{ existing.seal.name }}</b>. <NuxtLink :to="`/address/${wallet.address}`">Open the extract</NuxtLink>.</p>
                <RevokeButton class="mt-3" :address="wallet.address" :seal-pda="existing.sealPda" @revoked="onRevoked" />
              </div>
              <p v-if="revoked" class="mt-5 rounded-control bg-lilac-soft p-4 [overflow-wrap:anywhere]">Seal revoked. Transaction: <a :href="txLink(revoked)" target="_blank" rel="noopener" class="font-mono text-[13px]">{{ revoked }}</a></p>
            </template>
          </li>

          <li v-if="wallet && existing === null && !done" class="card-white">
            <h2 id="step-method" class="h3">2. Attestation</h2>
            <!-- Настоящие радиокнопки под прозрачным слоем: клавиатура, getByLabel и check() работают как раньше -->
            <div role="radiogroup" aria-labelledby="step-method" class="mt-4 flex flex-wrap gap-2">
              <label class="btn relative flex-[1_1_18rem]" :class="{ 'btn-primary': mode === 'nca' }"><input v-model="mode" type="radio" name="method" value="nca" class="toggle"> NCA of Kazakhstan (NCALayer)</label>
              <label class="btn relative flex-[1_1_18rem]" :class="{ 'btn-primary': mode === 'test' }"><input v-model="mode" type="radio" name="method" value="test" class="toggle"> Test attestor (demo)</label>
            </div>

            <fieldset v-if="mode === 'nca'" class="mt-7 min-w-0 space-y-4">
              <legend class="label">NCA of Kazakhstan</legend>
              <p class="text-[15px]">This is the request you sign with your company's NCA key. The attestor reads the company name and BIN from your certificate.</p>
              <pre class="code">{{ request.text }}</pre>
              <p class="note">The request is valid for 10 minutes. Signing refreshes it.</p>
              <div class="flex flex-wrap items-center gap-3">
                <button class="btn btn-primary" :disabled="busy" @click="attestNca">Sign with NCALayer</button>
                <span v-if="busy" class="note">{{ stage }}</span>
              </div>
            </fieldset>

            <fieldset v-else class="mt-7 min-w-0 space-y-4">
              <legend class="label">Test attestor (demo)</legend>
              <p class="rounded-control bg-coral/15 p-4 text-[15px] text-refusal">The attestor key is public. Anyone can mint such seals. Demo only.</p>
              <div class="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <label class="block text-[15px] font-bold">Company name<input v-model="name" class="field mt-2" maxlength="128"></label>
                <label class="block text-[15px] font-bold">BIN<input v-model="bin" class="field mt-2" inputmode="numeric" maxlength="12"></label>
              </div>
              <button class="btn btn-primary" :disabled="busy" @click="attestTest">Sign with the test attestor</button>
            </fieldset>

            <p v-if="attestation" class="mt-6 rounded-control bg-lilac-soft p-4">
              Attested by <AddressText :address="attestation.trustService" />: <b>{{ attestation.name }}</b><span v-if="attestation.bin">, BIN {{ attestation.bin }}</span>.
              The BIN stays in this browser and does not go on-chain.
            </p>
          </li>

          <li v-if="attestation && !done" class="card-white">
            <h2 class="h3">3. Register</h2>
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <button class="btn btn-primary" :disabled="busy" @click="register">Register seal</button>
              <span v-if="busy" class="note">Simulating and sending…</span>
            </div>
          </li>

          <li v-if="done" class="card-white">
            <h2 class="h3">Seal registered</h2>
            <p class="mt-3"><b>{{ done.name }}</b>, KZ, attested, valid until {{ date(done.expiresAt) }}.</p>
            <p class="mt-1 [overflow-wrap:anywhere]">Extract: <NuxtLink :to="`/address/${wallet!.address}`">open</NuxtLink>. Transaction: <a :href="txLink(done.sig)" target="_blank" rel="noopener" class="font-mono text-[13px]">{{ done.sig }}</a></p>
            <div class="mt-5 rounded-control bg-lilac-soft p-4">
              <p class="[overflow-wrap:anywhere]">Salt: <code class="font-mono text-[13px]">{{ done.salt }}</code></p>
              <button class="btn mt-3" @click="copySalt">{{ saltCopied ? 'Copied' : 'Copy salt' }}</button>
              <p class="note mt-3">Keep it. You need it to disclose your BIN to a counterparty. It is not stored anywhere else.</p>
            </div>
          </li>
        </ol>
        <div v-if="error" class="mt-4 rounded-control bg-coral/15 p-4">
          <p class="text-refusal">{{ error }}</p>
          <button v-if="existing === undefined" class="btn mt-3" @click="check">Retry</button>
        </div>
        <template #fallback>
          <div class="card-white"><span class="block h-6 w-32 animate-pulse rounded bg-lilac-soft" /></div>
        </template>
      </ClientOnly>
    </div>
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
    // Свежий дедлайн на каждую подпись; <pre> перерисуется тем же текстом, что уходит в NCALayer
    request.value = requestText(ids, wallet.value!.address, now())
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

<style scoped>
/* Прозрачная радиокнопка поверх всей кнопки-переключателя; её фокус рисует контур вокруг кнопки */
.toggle { @apply absolute inset-0 cursor-pointer appearance-none rounded-control; }
.toggle:focus-visible { outline-offset: 4px; }
</style>
