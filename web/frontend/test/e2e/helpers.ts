import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey } from '@solana/kit'

export const E2E_SEED: string = JSON.parse(readFileSync(new URL('./fixtures/wallet.json', import.meta.url), 'utf8')).seed
export const seedBytes = () => Uint8Array.from(E2E_SEED.match(/.{2}/g)!.map(x => parseInt(x, 16)))

export async function e2eAddress(): Promise<string> {
  const keyPair = await createKeyPairFromPrivateKeyBytes(seedBytes())
  return getAddressFromPublicKey(keyPair.publicKey)
}

// Демо-кошелёк страницы = e2e-кошелёк, подключается сам при загрузке
export async function withE2eWallet(page: Page) {
  await page.addInitScript((seed: string) => {
    localStorage.setItem('mor-demo-seed', seed)
    localStorage.setItem('mor-wallet', 'Built-in demo wallet')
  }, E2E_SEED)
}
