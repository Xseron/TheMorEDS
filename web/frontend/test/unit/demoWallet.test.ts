import {
  AccountRole, appendTransactionMessageInstructions, compileTransaction, createTransactionMessage, generateKeyPair, getAddressFromPublicKey,
  getPublicKeyFromAddress, getTransactionDecoder, getTransactionEncoder, isFullySignedTransaction, partiallySignTransaction, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash, verifySignature, type Address, type Blockhash,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { demoWallet } from '../../app/utils/demoWallet'
import { DEMO } from '../../app/utils/registry'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

// Транзакция, где кроме плательщика нужна подпись второго ключа (как у нового минта)
const twoSigners = (payer: Address, second: Address) => compileTransaction(pipe(
  createTransactionMessage({ version: 'legacy' }),
  m => setTransactionMessageFeePayer(payer, m),
  m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: DEMO.b as string as Blockhash, lastValidBlockHeight: 1_000n }, m),
  m => appendTransactionMessageInstructions([{ programAddress: DEMO.c, accounts: [{ address: second, role: AccountRole.READONLY_SIGNER }] }], m),
))

describe('demoWallet', () => {
  it('adds only its own signature and leaves the second signer to follow', async () => {
    const wallet = await demoWallet(memory())
    const mint = await generateKeyPair()
    const mintAddress = await getAddressFromPublicKey(mint.publicKey)

    const wire = await wallet.signTransaction(new Uint8Array(getTransactionEncoder().encode(twoSigners(wallet.address, mintAddress))))
    const signed = getTransactionDecoder().decode(wire)
    const own = signed.signatures[wallet.address]
    expect(own).toBeTruthy()
    expect(await verifySignature(await getPublicKeyFromAddress(wallet.address), own!, signed.messageBytes)).toBe(true)
    expect(signed.signatures[mintAddress]).toBeNull()
    expect(isFullySignedTransaction(signed)).toBe(false)

    const full = await partiallySignTransaction([mint], signed)
    expect(isFullySignedTransaction(full)).toBe(true)
  })
})
