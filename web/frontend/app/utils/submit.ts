// Отправка от имени любого кошелька: сначала симуляция через наш RPC, потом подпись, потом ожидание
import {
  appendTransactionMessageInstructions, assertIsFullySignedTransaction, compileTransaction, createTransactionMessage, getBase64EncodedWireTransaction,
  getTransactionDecoder, getTransactionEncoder, partiallySignTransaction, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
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

export async function submit(rpc: SubmitRpc, wallet: Wallet, instructions: Instruction[], sleep = wait, extraSigners: CryptoKeyPair[] = []): Promise<Signature> {
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
  let signed = getTransactionDecoder().decode(signedWire)
  // Новые аккаунты (минт облигации) подписывают своим ключом после кошелька
  if (extraSigners.length) signed = await partiallySignTransaction(extraSigners, signed)
  // Не хватает подписи: понятная ошибка здесь, а не отказ RPC
  assertIsFullySignedTransaction(signed)
  const signature = (await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send()) as Signature

  // Транзакция уже отправлена: сбой RPC (429 и т. п.) не значит, что она не прошла, поэтому опрос продолжается
  const giveUpAt = Date.now() + 90_000
  const unconfirmed = () => new Error(`Could not confirm the transaction. Check the signature on an explorer: ${signature}`)
  for (;;) {
    // undefined: RPC не ответил, null: сеть транзакцию ещё не видела
    const status = await rpc.getSignatureStatuses([signature]).send().then(r => r.value[0] ?? null, () => undefined)
    if (status?.err) throw new OnChainError(signature, status.err)
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature
    const height = await rpc.getBlockHeight({ commitment: 'confirmed' }).send().catch(() => undefined)
    if (height !== undefined && height > latest.lastValidBlockHeight) throw status === undefined ? unconfirmed() : new ExpiredError()
    if (height === undefined && Date.now() > giveUpAt) throw unconfirmed()
    await sleep(1500)
  }
}
