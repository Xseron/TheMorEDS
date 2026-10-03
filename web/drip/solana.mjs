// Одна транзакция на выдачу: SOL, ATA получателя и mintTo демо-токена. Билдеры из scripts/devnet-v1/src/token.ts
import { readFile } from 'node:fs/promises'
import {
  AccountRole, address, appendTransactionMessageInstructions, compileTransaction, createKeyPairFromBytes, createSolanaRpc,
  createTransactionMessage, getAddressEncoder, getAddressFromPublicKey, getBase64EncodedWireTransaction, getProgramDerivedAddress,
  getSignatureFromTransaction, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, signTransaction,
} from '@solana/kit'

export const SYSTEM_PROGRAM = address('11111111111111111111111111111111')
export const TOKEN_2022 = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const bytes = a => new Uint8Array(getAddressEncoder().encode(a))

export function u64le(n) {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, true)
  return b
}

function u32le(n) {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// SystemInstruction::Transfer (2)
export function transferSolInstruction(from, to, lamports) {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from, role: AccountRole.WRITABLE_SIGNER },
      { address: to, role: AccountRole.WRITABLE },
    ],
    data: concat(u32le(2), u64le(lamports)),
  }
}

// Associated Token Account: CreateIdempotent (1)
export function createAtaIdempotentInstruction(payer, ata, owner, mint) {
  return {
    programAddress: ATA_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  }
}

// MintTo (7): хук на mintTo не вызывается
export function mintToInstruction(mint, destination, authority, amount) {
  return {
    programAddress: TOKEN_2022,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data: concat(new Uint8Array([7]), u64le(amount)),
  }
}

export async function ataOf(owner, mint) {
  const [pda] = await getProgramDerivedAddress({ programAddress: ATA_PROGRAM, seeds: [bytes(owner), bytes(TOKEN_2022), bytes(mint)] })
  return pda
}

export async function dripInstructions({ issuer, to, mint, lamports, tokens }) {
  const ata = await ataOf(to, mint)
  return [
    transferSolInstruction(issuer, to, lamports),
    createAtaIdempotentInstruction(issuer, ata, to, mint),
    mintToInstruction(mint, ata, issuer, tokens),
  ]
}

// Ключ в формате Solana CLI: JSON-массив из 64 байт. Текст ошибки JSON.parse цитирует файл, поэтому он не уходит в лог
export async function loadKeyPair(path) {
  let bytes
  try {
    bytes = Uint8Array.from(JSON.parse(await readFile(path, 'utf8')))
  } catch (e) {
    throw new Error(`cannot read the key file ${path}: ${e.code ?? 'not a JSON array'}`)
  }
  const keyPair = await createKeyPairFromBytes(bytes)
  return { keyPair, issuer: await getAddressFromPublicKey(keyPair.publicKey) }
}

const wait = ms => new Promise(r => setTimeout(r, ms))
// Зависший запрос к RPC иначе держал бы всю очередь выдач
const timeout = () => ({ abortSignal: AbortSignal.timeout(20_000) })

export function createSender({ rpcUrl, keyPair, issuer, mint, lamports, tokens, sleep = wait }) {
  const rpc = createSolanaRpc(rpcUrl)
  return {
    issuer,
    async balance() {
      return (await rpc.getBalance(issuer, { commitment: 'confirmed' }).send(timeout())).value
    },
    async drip(to) {
      const instructions = await dripInstructions({ issuer, to, mint, lamports, tokens })
      const { value: latest } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send(timeout())
      const message = pipe(
        createTransactionMessage({ version: 'legacy' }),
        m => setTransactionMessageFeePayer(issuer, m),
        m => setTransactionMessageLifetimeUsingBlockhash(latest, m),
        m => appendTransactionMessageInstructions(instructions, m),
      )
      const signed = await signTransaction([keyPair], compileTransaction(message))
      const signature = getSignatureFromTransaction(signed)
      await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }).send(timeout())

      // Сбой опроса не значит, что транзакция не прошла: ждём до истечения blockhash, но не дольше 90 секунд
      const giveUpAt = Date.now() + 90_000
      for (;;) {
        const status = await rpc.getSignatureStatuses([signature]).send(timeout()).then(r => r.value[0] ?? null, () => undefined)
        if (status?.err) throw new Error(`failed on-chain: ${JSON.stringify(status.err, (_, v) => typeof v === 'bigint' ? v.toString() : v)} ${signature}`)
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return signature
        const height = await rpc.getBlockHeight({ commitment: 'confirmed' }).send(timeout()).catch(() => undefined)
        if (height !== undefined && height > latest.lastValidBlockHeight) throw new Error(`blockhash expired ${signature}`)
        if (Date.now() > giveUpAt) throw new Error(`not confirmed in 90 s ${signature}`)
        await sleep(1500)
      }
    },
  }
}
