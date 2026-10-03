import { address, createDefaultRpcTransport, createSolanaRpcFromTransport, getBase64Encoder, type Address, type Instruction } from '@solana/kit'
import { fromHex, type Ids } from '~/utils/registry'
import { withRetryOn429 } from '~/utils/retryTransport'
import { submit } from '~/utils/submit'

let rpcCache: { url: string; rpc: ReturnType<typeof createSolanaRpcFromTransport> } | null = null

export function useSolana() {
  const cfg = useRuntimeConfig().public
  if (!rpcCache || rpcCache.url !== cfg.rpcUrl) rpcCache = { url: cfg.rpcUrl, rpc: createSolanaRpcFromTransport(withRetryOn429(createDefaultRpcTransport({ url: cfg.rpcUrl }))) }
  const rpc = rpcCache.rpc
  const ids: Ids = { registry: address(cfg.registry), hook: address(cfg.hook), mint: address(cfg.mint) }
  const { wallet } = useWallet()

  async function send(instructions: Instruction[], extraSigners: CryptoKeyPair[] = []) {
    if (!wallet.value) throw new Error('Connect a wallet first')
    return submit(rpc, wallet.value, instructions, undefined, extraSigners)
  }

  const toBytes = (b64: string) => new Uint8Array(getBase64Encoder().encode(b64))
  async function accountData(a: Address): Promise<Uint8Array | null> {
    const { value } = await rpc.getAccountInfo(a, { encoding: 'base64' }).send()
    return value ? toBytes(value.data[0]) : null
  }
  async function accountsData(as: Address[]): Promise<(Uint8Array | null)[]> {
    const { value } = await rpc.getMultipleAccounts(as, { encoding: 'base64' }).send()
    return value.map(v => (v ? toBytes(v.data[0]) : null))
  }

  return {
    rpc, ids, send, accountData, accountsData,
    bondProgram: address(cfg.bondProgram),
    tkztMint: address(cfg.tkztMint),
    kaseReferenceMint: address(cfg.kaseReferenceMint),
    attestorUrl: cfg.attestorUrl,
    attestorAddress: address(cfg.attestorAddress),
    testAttestorKey: fromHex(cfg.testAttestorKey),
    explorer: (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`,
    txLink: (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`,
  }
}
