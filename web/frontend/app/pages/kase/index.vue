<template>
  <div class="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
    <header>
      <h1>Corporate actions for a tokenized bond</h1>
      <p class="mt-5 text-muted">A test bond on Solana devnet. Holders are companies identified by MOR seals. The program fixes the register on each record date, pays coupons in tKZT and redeems the bonds: part early, the rest at maturity</p>
      <h2 class="h3 mt-8">How the record date works</h2>
      <p class="mt-2">Whoever runs a cash corporate action must answer one question: have we found every holder on the record date? Normally an off-chain intermediary answers it and the issuer trusts the answer. Here the program proves it</p>
      <p class="mt-4">An event is complete only when every row of the register is processed, and anyone can enumerate that register. After a record date a holder can move bonds only once the account is snapshotted. Anyone can take the snapshots</p>
      <p class="mt-4"><NuxtLink :to="`/kase/bond/${kaseReferenceMint}`">Open the reference bond</NuxtLink>: a full lifecycle already recorded on devnet</p>
    </header>

    <div class="band -mx-5 space-y-4 rounded-none p-5 sm:mx-0 sm:rounded-card md:p-10 lg:self-start">
      <ClientOnly>
        <section class="card-white" :class="{ 'opacity-60': step < 1 }">
          <p class="label">Step 1</p>
          <h2 class="h3 mt-1">Wallet</h2>
          <WalletButton v-if="!wallet" class="mt-4" />
          <p v-else class="mt-2">Issuer: <AddressText :address="wallet.address" /></p>
        </section>
        <section class="card-white" :class="{ 'opacity-60': step < 2 }">
          <p class="label">Step 2</p>
          <h2 class="h3 mt-1">Issuer seal</h2>
          <p v-if="issuerName" class="mt-2">Sealed as <b>{{ issuerName }}</b></p>
          <p v-else-if="wallet && !checked" class="note mt-2">Checking the seal</p>
          <template v-else>
            <p class="mt-2">The issuer needs a MOR seal. Seal this wallet with the test attestor, or use the <NuxtLink to="/seal">Seal page</NuxtLink> with NCALayer</p>
            <button class="btn mt-4" :disabled="busy || !wallet" @click="sealIssuer">Seal with the test attestor</button>
          </template>
        </section>
        <section class="card-white" :class="{ 'opacity-60': step < 3 }">
          <p class="label">Step 3</p>
          <h2 class="h3 mt-1">Demo investors</h2>
          <p class="note mt-2">Three demo companies hold the bond. Their keys live in this browser and protect nothing</p>
          <ul class="mt-4 space-y-2 text-[15px]">
            <li v-for="(w, i) in wallets" :key="w.address" class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b>{{ INVESTORS[i]!.name }}</b><span class="text-muted">{{ INVESTORS[i]!.bonds }} bonds</span>
              <AddressText :address="w.address" />
              <StatusBadge :text="sealed[w.address] ? 'Sealed' : 'No seal yet'" :tone="sealed[w.address] ? 'violet' : 'muted'" testid="investor-status" />
            </li>
          </ul>
          <button class="btn mt-4" :disabled="busy || step < 3" @click="prepareInvestors">Prepare investors</button>
        </section>
        <section class="card-white" :class="{ 'opacity-60': step < 4 }">
          <p class="label">Step 4</p>
          <h2 class="h3 mt-1">Terms</h2>
          <p class="mt-2 text-[15px]">Face value 1,000.00 tKZT, coupon 10% a year paid twice a year, two years, four events. In this demo one period lasts</p>
          <div class="mt-3 flex gap-6">
            <label class="flex items-center gap-2"><input v-model="period" type="radio" value="120" class="accent-violet"> 2 minutes</label>
            <label class="flex items-center gap-2"><input v-model="period" type="radio" value="60" class="accent-violet"> 1 minute</label>
          </div>
          <button class="btn btn-primary mt-5 max-sm:w-full" :disabled="busy || step < 4" @click="issue">Issue bond</button>
        </section>
        <p v-if="progress" class="note">{{ progress }}</p>
        <div v-if="error" class="card-white">
          <SealStatus status="rejected" class="mb-4" />
          <p class="text-refusal">{{ error }}</p>
          <p v-if="createdMint" class="mt-4"><NuxtLink :to="`/kase/bond/${createdMint}`">Open the bond</NuxtLink></p>
        </div>
        <template #fallback>
          <div class="card-white"><span class="block h-6 w-48 animate-pulse rounded bg-lilac-soft" /></div>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>

<script setup lang="ts">
import { createNoopSigner, generateKeyPair, getAddressFromPublicKey, type Instruction } from '@solana/kit'
import { attestWithTestKey, registerInstructions } from '~/utils/attestation'
import { ata2022, createAta2022Instruction, demoTerms, setComputeUnitLimitInstruction } from '~/utils/bond'
import { getCreateBondInstructionAsync, getIssueInstructionAsync, getRegisterHolderInstructionAsync } from '~/utils/bond/generated'
import { describeError } from '~/utils/errors'
import { sealPda } from '~/utils/registry'

useSeoMeta({
  title: 'Corporate actions for a tokenized bond',
  description: 'Record date, coupon, early redemption and maturity for a test bond on Solana devnet. Holders are companies identified by MOR seals',
})

const solana = useSolana()
const { ids, bondProgram, tkztMint, kaseReferenceMint, testAttestorKey, attestorUrl, accountData } = solana
const { wallet } = useWallet()
const { lookup, invalidate } = useRegistry()
const { wallets, load, prepare } = useInvestors()

const issuerName = ref('')
const sealed = ref<Record<string, boolean>>({})
const period = ref('120')
const busy = ref(false)
// Первая проверка печатей завершена: до неё кнопку печати не показываем
const checked = ref(false)
const progress = ref('')
const error = ref('')
const createdMint = ref('')
const step = computed(() => (!wallet.value ? 1 : !issuerName.value ? 2 : wallets.value.some(w => !sealed.value[w.address]) ? 3 : 4))
const now = () => BigInt(Math.floor(Date.now() / 1000))

async function refresh() {
  await load()
  if (wallet.value) {
    const l = await lookup(wallet.value.address, true)
    issuerName.value = l.status === 'valid' ? l.seal.name : ''
  } else {
    issuerName.value = ''
  }
  const flags = await Promise.all(wallets.value.map(async w => !!(await accountData(await sealPda(ids, w.address)))))
  sealed.value = Object.fromEntries(wallets.value.map((w, i) => [w.address, flags[i]!]))
  checked.value = true
}
onMounted(refresh)
watch(() => wallet.value?.address, refresh)

// Выпущенные в этом браузере облигации: по ним досье решает, показывать ли кнопки инвесторов
function rememberBond(mint: string) {
  try {
    const mine = JSON.parse(localStorage.getItem('kase-bonds') ?? '[]') as string[]
    localStorage.setItem('kase-bonds', JSON.stringify([...mine, mint]))
  } catch {
    try { localStorage.setItem('kase-bonds', JSON.stringify([mint])) } catch { /* хранилище закрыто */ }
  }
}

async function run(fn: () => Promise<void>) {
  busy.value = true
  error.value = ''
  createdMint.value = ''
  try { await fn() } catch (e) { error.value = describeError(e, { attestorUrl }) } finally { busy.value = false; progress.value = '' }
}

const sealIssuer = () => run(async () => {
  const owner = wallet.value!.address
  progress.value = 'Sealing the issuer with the test attestor'
  const a = await attestWithTestKey(ids, testAttestorKey, owner, 'Demo Issuer JSC', '000000000009', now())
  await solana.send(registerInstructions(ids, a, owner, await sealPda(ids, owner)))
  invalidate(owner)
  await refresh()
})

const prepareInvestors = () => run(async () => {
  await prepare(text => (progress.value = text))
  await refresh()
})

const issue = () => run(async () => {
  const issuer = createNoopSigner(wallet.value!.address)
  const mintKeys = await generateKeyPair()
  const mint = await getAddressFromPublicKey(mintKeys.publicKey)
  progress.value = 'Creating the bond'
  await solana.send([await getCreateBondInstructionAsync({
    issuer, issuerSeal: await sealPda(ids, issuer.address), mint: createNoopSigner(mint), paymentMint: tkztMint,
    terms: demoTerms(now(), BigInt(period.value)),
  }, { programAddress: bondProgram })], [mintKeys])
  // Минт запоминаем сразу: если дальше что-то упадёт, облигация уже есть и досье её покажет
  createdMint.value = mint
  rememberBond(mint)
  // Все три держателя одной транзакцией: выпуск открыт только до первой даты фиксации, а подтверждений кошелька должно быть два
  progress.value = 'Registering the investors and issuing the bonds'
  const holderInstructions: Instruction[] = [setComputeUnitLimitInstruction(400_000)]
  for (const [i, w] of wallets.value.entries()) {
    const tokenAccount = await ata2022(w.address, mint)
    holderInstructions.push(
      createAta2022Instruction(issuer.address, tokenAccount, w.address, mint),
      await getRegisterHolderInstructionAsync({ payer: issuer, mint, tokenAccount, ownerSeal: await sealPda(ids, w.address) }, { programAddress: bondProgram }),
      await getIssueInstructionAsync({ issuer, mint, tokenAccount, amount: INVESTORS[i]!.bonds }, { programAddress: bondProgram }),
    )
  }
  await solana.send(holderInstructions)
  await navigateTo(`/kase/bond/${mint}`)
})
</script>
