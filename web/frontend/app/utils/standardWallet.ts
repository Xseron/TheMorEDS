// Обёртка кошелька Wallet Standard (Phantom, Solflare, Backpack) в наш интерфейс Wallet
import { address, type Address } from '@solana/kit'
import { SolanaSignTransaction, type SolanaSignTransactionFeature } from '@solana/wallet-standard-features'
import type { Wallet as StandardWallet, WalletAccount } from '@wallet-standard/base'
import {
  StandardConnect, StandardDisconnect, StandardEvents,
  type StandardConnectFeature, type StandardDisconnectFeature, type StandardEventsFeature,
} from '@wallet-standard/features'
import type { Wallet } from './submit'

export const CHAIN = 'solana:devnet'

export function isSolanaSigner(w: StandardWallet): boolean {
  return SolanaSignTransaction in w.features && StandardConnect in w.features
}

export async function connectStandard(w: StandardWallet, silent = false) {
  const { connect } = w.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect]
  const { accounts } = await connect({ silent })
  const account: WalletAccount | undefined = accounts.find(a => a.chains.includes(CHAIN)) ?? accounts[0]
  if (!account) throw new Error(`${w.name} returned no account`)
  const { signTransaction } = w.features[SolanaSignTransaction] as SolanaSignTransactionFeature[typeof SolanaSignTransaction]

  const wallet: Wallet = {
    name: w.name,
    icon: w.icon,
    address: address(account.address),
    async signTransaction(wire) {
      const [signed] = await signTransaction({ account, transaction: wire, chain: CHAIN })
      if (!signed) throw new Error(`${w.name} returned no signed transaction`)
      return signed.signedTransaction
    },
  }

  const onChange = (cb: (a: Address | null) => void) => {
    const events = w.features[StandardEvents] as StandardEventsFeature[typeof StandardEvents] | undefined
    if (!events) return () => {}
    return events.on('change', ({ accounts }) => {
      if (!accounts) return
      cb(accounts[0] ? address(accounts[0].address) : null)
    })
  }

  const disconnect = async () => {
    const d = w.features[StandardDisconnect] as StandardDisconnectFeature[typeof StandardDisconnect] | undefined
    await d?.disconnect()
  }

  return { wallet, onChange, disconnect }
}
