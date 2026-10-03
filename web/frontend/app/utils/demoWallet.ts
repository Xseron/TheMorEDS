// Встроенный демо-кошелёк: сид в localStorage этого браузера, ключ через WebCrypto. Ничего не защищает.
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, getTransactionDecoder, getTransactionEncoder, partiallySignTransaction } from '@solana/kit'
import { fromHex, hex } from './registry'
import type { Wallet } from './submit'

export const DEMO_WALLET_NAME = 'Built-in demo wallet'
export const SEED_KEY = 'mor-demo-seed'

export async function demoWallet(storage: Pick<Storage, 'getItem' | 'setItem'>, key = SEED_KEY, name = DEMO_WALLET_NAME): Promise<Wallet> {
  let seed = fromHex(storage.getItem(key) ?? '')
  if (seed.length !== 32) {
    seed = crypto.getRandomValues(new Uint8Array(32))
    storage.setItem(key, hex(seed))
  }
  const keyPair = await createKeyPairFromPrivateKeyBytes(seed)
  return {
    name,
    address: await getAddressFromPublicKey(keyPair.publicKey),
    // Как настоящий кошелёк: только своя подпись, остальные подписанты добавят свои после
    async signTransaction(wire) {
      const signed = await partiallySignTransaction([keyPair], getTransactionDecoder().decode(wire))
      return new Uint8Array(getTransactionEncoder().encode(signed))
    },
  }
}

// Ed25519 в WebCrypto: Chrome 137+, Firefox 130+, Safari 17+
export async function hasEd25519(): Promise<boolean> {
  try { await crypto.subtle.generateKey('Ed25519', false, ['sign']); return true } catch { return false }
}
