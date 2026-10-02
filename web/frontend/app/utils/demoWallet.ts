// Встроенный демо-кошелёк: сид в localStorage этого браузера, ключ через WebCrypto. Ничего не защищает.
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, getTransactionDecoder, getTransactionEncoder, signTransaction } from '@solana/kit'
import { fromHex, hex } from './registry'
import type { Wallet } from './submit'

export const DEMO_WALLET_NAME = 'Built-in demo wallet'
export const SEED_KEY = 'mor-demo-seed'

export async function demoWallet(storage: Pick<Storage, 'getItem' | 'setItem'>): Promise<Wallet> {
  let seed = fromHex(storage.getItem(SEED_KEY) ?? '')
  if (seed.length !== 32) {
    seed = crypto.getRandomValues(new Uint8Array(32))
    storage.setItem(SEED_KEY, hex(seed))
  }
  const keyPair = await createKeyPairFromPrivateKeyBytes(seed)
  return {
    name: DEMO_WALLET_NAME,
    address: await getAddressFromPublicKey(keyPair.publicKey),
    async signTransaction(wire) {
      const signed = await signTransaction([keyPair], getTransactionDecoder().decode(wire))
      return new Uint8Array(getTransactionEncoder().encode(signed))
    },
  }
}

// Ed25519 в WebCrypto: Chrome 137+, Firefox 130+, Safari 17+
export async function hasEd25519(): Promise<boolean> {
  try { await crypto.subtle.generateKey('Ed25519', false, ['sign']); return true } catch { return false }
}
