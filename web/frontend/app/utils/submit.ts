// Отправка от имени любого кошелька: сначала симуляция через наш RPC, потом подпись, потом ожидание
import {
  appendTransactionMessageInstructions, compileTransaction, createTransactionMessage, getBase64EncodedWireTransaction,
  getTransactionDecoder, getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  type Address, type Blockhash, type Instruction, type Signature,
} from '@solana/kit'
import { ExpiredError, OnChainError, SimulationError } from './errors'

export interface Wallet {
  name: string
  icon?: string
  address: Address
  signTransaction(wire: Uint8Array): Promise<Uint8Array>
}

// Ровно то, что нужно отправке; в тестах подменяется объектом
export type SubmitRpc = {
  getLatestBlockhash(): { send(): Promise<{ value: { blockhash: string; lastValidBlockHeight: bigint } }> }
  simulateTransaction(tx: string, cfg: object): { send(): Promise<{ value: { err: unknown; logs: readonly string[] | null } }> }
  sendTransaction(tx: string, cfg: object): { send(): Promise<string> }
  getSignatureStatuses(sigs: readonly string[]): { send(): Promise<{ value: readonly ({ err: unknown; confirmationStatus: string | null } | null)[] }> }
  getBlockHeight(cfg: object): { send(): Promise<bigint> }
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function submit(rpc: SubmitRpc, wallet: Wallet, instructions: Instruction[], sleep = wait): Promise<Signature> {
  const { value: latest } = await rpc.getLatestBlockhash().send()
  const lifetime = { blockhash: latest.blockhash as Blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    m => setTransactionMessageFeePayer(wallet.address, m),
    m => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    m => appendTransactionMessageInstructions(instructions, m),
  )
  const unsigned = compileTransaction(message)

  const sim = await rpc.simulateTransaction(getBase64EncodedWireTransaction(unsigned), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }).send()
  if (sim.value.err) throw new SimulationError(sim.value.err, [...(sim.value.logs ?? [])])

  const signedWire = await wallet.signTransaction(new Uint8Array(getTransactionEncoder().encode(unsigned)))
  const signed = getTransactionDecoder().decode(signedWire)
  const signature = (await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send()) as Signature

  for (;;) {
    const { value: [status] } = await rpc.getSignatureStatuses([signature]).send()
    if (status?.err) throw new OnChainError(signature, status.err)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature
    if ((await rpc.getBlockHeight({ commitment: 'confirmed' }).send()) > latest.lastValidBlockHeight) throw new ExpiredError()
    await sleep(1500)
  }
}
