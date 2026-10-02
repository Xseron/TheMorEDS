import { getBase64Encoder, type Address } from '@solana/kit'
import { NotASeal, TEST_TRUST_SERVICES, decodeSeal, decodeTrustService, parseAddress, sealPda, type Seal, type TrustService } from '~/utils/registry'

export type Lookup
  = { status: 'invalid' }
    | { status: 'none'; address: Address; sealPda: Address }
    | { status: 'valid' | 'expired'; address: Address; sealPda: Address; seal: Seal; trust: TrustService | null; trustIsTest: boolean; slot: bigint; checkedAt: Date }

// Кэш на вкладку: hero и выписка одного адреса читают devnet один раз
const cache = new Map<string, Promise<Lookup>>()

export function useRegistry() {
  const { rpc, ids, accountData } = useSolana()

  async function read(a: Address): Promise<Lookup> {
    const pda = await sealPda(ids, a)
    const res = await rpc.getAccountInfo(pda, { encoding: 'base64' }).send()
    if (!res.value) return { status: 'none', address: a, sealPda: pda }
    let seal: Seal
    try {
      seal = decodeSeal(new Uint8Array(getBase64Encoder().encode(res.value.data[0])))
    } catch (e) {
      if (e instanceof NotASeal) return { status: 'none', address: a, sealPda: pda }
      throw e
    }
    const trustData = await accountData(seal.trustService)
    const now = BigInt(Math.floor(Date.now() / 1000))
    return {
      status: seal.expiresAt < now ? 'expired' : 'valid',
      address: a, sealPda: pda, seal,
      trust: trustData ? decodeTrustService(trustData) : null,
      trustIsTest: TEST_TRUST_SERVICES.includes(seal.trustService),
      slot: BigInt(res.context.slot),
      checkedAt: new Date(),
    }
  }

  function lookup(text: string, fresh = false): Promise<Lookup> {
    const a = parseAddress(text)
    if (!a) return Promise.resolve({ status: 'invalid' })
    if (!fresh && cache.has(a)) return cache.get(a)!
    const p = read(a)
    cache.set(a, p)
    p.catch(() => cache.delete(a))
    return p
  }

  return { lookup, invalidate: (a: string) => cache.delete(a) }
}
