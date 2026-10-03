// Досье облигации: аккаунты программы по минту, балансы, время кластера. Обновляется, пока вкладка видна
import { getBase64Encoder, type Address, type ReadonlyUint8Array } from '@solana/kit'
import {
  BOND_EVENT_DISCRIMINATOR, HOLDER_STATE_DISCRIMINATOR, SNAPSHOT_DISCRIMINATOR,
  getBondDecoder, getBondEventDecoder, getHolderStateDecoder, getSnapshotDecoder,
  type Bond, type BondEvent, type HolderState, type Snapshot,
} from '~/utils/bond/generated'
import { ata2022, bondPda, vaultPda } from '~/utils/bond'

export type Row = HolderState & { address: Address; balance: bigint }
export type BondView = {
  bond: Bond; supply: bigint; vaultBalance: bigint; issuerTkzt: bigint; events: BondEvent[]; rows: Row[]; snapshots: Snapshot[]
  now: bigint; loadedAt: number
}

const b64 = getBase64Encoder()
// Токен-аккаунт: amount с 64-го байта; минт: supply с 36-го
const u64At = (d: Uint8Array | null, offset: number) => (d ? new DataView(d.buffer, d.byteOffset).getBigUint64(offset, true) : 0n)
const POLL_MS = 10_000

export function useBond(mint: Ref<Address | null>) {
  const { rpc, bondProgram, tkztMint, accountData, accountsData } = useSolana()
  const view = ref<BondView | null>(null)
  const missing = ref(false)
  // Сбой чтения, пока данных ещё нет: страница показывает ошибку вместо вечного скелета
  const error = ref(false)

  // Все аккаунты облигации одним запросом: у каждого типа минт сразу после 8 байт дискриминатора
  async function byMint(m: Address) {
    const res = await rpc.getProgramAccounts(bondProgram, {
      encoding: 'base64',
      filters: [{ memcmp: { offset: 8n, bytes: m as never, encoding: 'base58' } }],
    }).send()
    const all = res.map(r => ({ address: r.pubkey, data: new Uint8Array(b64.encode(r.account.data[0])) }))
    const of = (d: ReadonlyUint8Array) => all.filter(a => a.data.length >= 8 && d.every((b, i) => a.data[i] === b))
    return { events: of(BOND_EVENT_DISCRIMINATOR), holders: of(HOLDER_STATE_DISCRIMINATOR), snaps: of(SNAPSHOT_DISCRIMINATOR) }
  }

  async function fetchView() {
    const m = mint.value
    if (!m) return
    const bondData = await accountData(await bondPda(bondProgram, m))
    if (mint.value !== m) return
    if (!bondData) { missing.value = true; view.value = null; return }
    const [{ events, holders, snaps }, slot] = await Promise.all([byMint(m), rpc.getSlot({ commitment: 'confirmed' }).send()])
    const bond = getBondDecoder().decode(bondData)
    const rows = holders.map(h => ({ ...getHolderStateDecoder().decode(h.data), address: h.address }))
    const issuerAta = await ata2022(bond.issuer, tkztMint)
    const [mintData, vaultData, issuerData, ...tokens] = await accountsData([m, await vaultPda(bondProgram, m), issuerAta, ...rows.map(r => r.tokenAccount)])
    // Время блока необязательно: без него идём по локальным часам
    const time = await rpc.getBlockTime(slot).send().catch(() => null)
    if (mint.value !== m) return // минт сменили, пока ждали RPC
    missing.value = false
    view.value = {
      bond,
      supply: u64At(mintData ?? null, 36),
      vaultBalance: u64At(vaultData ?? null, 64),
      issuerTkzt: u64At(issuerData ?? null, 64),
      events: events.map(e => getBondEventDecoder().decode(e.data)).sort((a, b) => a.k - b.k),
      rows: rows.map((r, i) => ({ ...r, balance: u64At(tokens[i] ?? null, 64) })),
      snapshots: snaps.map(s => getSnapshotDecoder().decode(s.data)),
      now: time === null ? BigInt(Math.floor(Date.now() / 1000)) : BigInt(time),
      loadedAt: Date.now(),
    }
  }

  // Один прогон за раз. Просьба во время прогона ждёт его и запускает ещё один, уже со свежими данными
  let running: Promise<void> | null = null
  let queued: Promise<void> | null = null
  function load(): Promise<void> {
    if (!running) {
      return (running = fetchView().then(() => { error.value = false }, (e) => {
        if (!view.value) error.value = true
        throw e
      }).finally(() => { running = null }))
    }
    return (queued ??= running.catch(() => {}).then(() => { queued = null; return load() }))
  }

  // Пока идёт действие, опрос стоит и не отнимает у него лимит RPC
  let paused = false
  const pause = () => { paused = true }
  const resume = () => { paused = false }

  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    load().catch(() => {})
    timer = setInterval(() => {
      if (!running && !paused && document.visibilityState === 'visible') load().catch(() => {})
    }, POLL_MS)
  })
  onBeforeUnmount(() => clearInterval(timer))
  watch(mint, () => { view.value = null; missing.value = false; error.value = false; load().catch(() => {}) })
  return { view, missing, error, load, pause, resume }
}
