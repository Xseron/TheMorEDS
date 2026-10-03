// Досье облигации: аккаунты программы по минту, балансы, время кластера. Обновляется, пока вкладка видна
import { getBase58Decoder, getBase64Encoder, type Address } from '@solana/kit'
import {
  BOND_EVENT_DISCRIMINATOR, HOLDER_STATE_DISCRIMINATOR, SNAPSHOT_DISCRIMINATOR,
  getBondDecoder, getBondEventDecoder, getHolderStateDecoder, getSnapshotDecoder,
  type Bond, type BondEvent, type HolderState, type Snapshot,
} from '~/utils/bond/generated'
import { bondPda, vaultPda } from '~/utils/bond'

export type Row = HolderState & { address: Address; balance: bigint }
export type BondView = {
  bond: Bond; supply: bigint; vaultBalance: bigint; events: BondEvent[]; rows: Row[]; snapshots: Snapshot[]
  now: bigint; loadedAt: number
}

const b64 = getBase64Encoder()
const b58 = getBase58Decoder()
// Токен-аккаунт: amount с 64-го байта; минт: supply с 36-го
const u64At = (d: Uint8Array | null, offset: number) => (d ? new DataView(d.buffer, d.byteOffset).getBigUint64(offset, true) : 0n)

export function useBond(mint: Ref<Address | null>) {
  const { rpc, bondProgram, accountData, accountsData } = useSolana()
  const view = ref<BondView | null>(null)
  const missing = ref(false)

  async function byMint(m: Address, discriminator: Uint8Array) {
    const res = await rpc.getProgramAccounts(bondProgram, {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0n, bytes: b58.decode(discriminator) as never, encoding: 'base58' } },
        { memcmp: { offset: 8n, bytes: m as never, encoding: 'base58' } },
      ],
    }).send()
    return res.map(r => ({ address: r.pubkey, data: new Uint8Array(b64.encode(r.account.data[0])) }))
  }

  async function load() {
    const m = mint.value
    if (!m) return
    const bondData = await accountData(await bondPda(bondProgram, m))
    if (mint.value !== m) return
    if (!bondData) { missing.value = true; view.value = null; return }
    const [events, holders, snaps, slot] = await Promise.all([
      byMint(m, BOND_EVENT_DISCRIMINATOR), byMint(m, HOLDER_STATE_DISCRIMINATOR), byMint(m, SNAPSHOT_DISCRIMINATOR),
      rpc.getSlot({ commitment: 'confirmed' }).send(),
    ])
    const rows = holders.map(h => ({ ...getHolderStateDecoder().decode(h.data), address: h.address }))
    const [mintData, vaultData, ...tokens] = await accountsData([m, await vaultPda(bondProgram, m), ...rows.map(r => r.tokenAccount)])
    const time = await rpc.getBlockTime(slot).send()
    if (mint.value !== m) return // минт сменили, пока ждали RPC
    missing.value = false
    view.value = {
      bond: getBondDecoder().decode(bondData),
      supply: u64At(mintData ?? null, 36),
      vaultBalance: u64At(vaultData ?? null, 64),
      events: events.map(e => getBondEventDecoder().decode(e.data)).sort((a, b) => a.k - b.k),
      rows: rows.map((r, i) => ({ ...r, balance: u64At(tokens[i] ?? null, 64) })),
      snapshots: snaps.map(s => getSnapshotDecoder().decode(s.data)),
      now: time === null ? BigInt(Math.floor(Date.now() / 1000)) : BigInt(time),
      loadedAt: Date.now(),
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    load().catch(() => {})
    timer = setInterval(() => { if (document.visibilityState === 'visible') load().catch(() => {}) }, 5_000)
  })
  onBeforeUnmount(() => clearInterval(timer))
  watch(mint, () => { view.value = null; missing.value = false; load().catch(() => {}) })
  return { view, missing, load }
}
