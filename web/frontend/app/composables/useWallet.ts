import { getWallets } from '@wallet-standard/app'
import type { Wallet as StandardWallet } from '@wallet-standard/base'
import { DEMO_WALLET_NAME, demoWallet, hasEd25519 } from '~/utils/demoWallet'
import { connectStandard, isSolanaSigner } from '~/utils/standardWallet'
import type { Wallet } from '~/utils/submit'

export type WalletOption = { name: string; icon?: string; note?: string }

const LAST_KEY = 'mor-wallet'
// Объекты расширений не кладём в реактивное состояние: прокси Vue ломает их внутренности
const standard = new Map<string, StandardWallet>()
let unsubscribe: (() => void) | null = null
let listening = false

export function useWallet() {
  const options = useState<WalletOption[]>('wallet-options', () => [])
  const wallet = useState<Wallet | null>('wallet', () => null)
  const connecting = useState('wallet-connecting', () => false)
  const drip = useDrip()

  function refresh() {
    if (!import.meta.client) return
    standard.clear()
    const found = getWallets().get().filter(isSolanaSigner).map((w) => {
      standard.set(w.name, w)
      return { name: w.name, icon: w.icon } as WalletOption
    })
    options.value = [...found, { name: DEMO_WALLET_NAME, note: 'lives in this browser, protects nothing' }]
  }

  async function connect(name: string, silent = false) {
    connecting.value = true
    try {
      if (name === DEMO_WALLET_NAME) {
        if (!(await hasEd25519())) throw new Error('This browser cannot create Ed25519 keys. Use a wallet extension')
        unsubscribe?.()
        wallet.value = await demoWallet(localStorage)
      } else {
        const w = standard.get(name)
        if (!w) throw new Error(`${name} is not available`)
        const c = await connectStandard(w, silent)
        unsubscribe?.()
        unsubscribe = c.onChange((a) => {
          if (!a) disconnect()
          else connect(name, true).catch(() => disconnect())
        })
        wallet.value = c.wallet
      }
      localStorage.setItem(LAST_KEY, name)
      // Кран только на подключение руками: тихое переподключение при загрузке и смена аккаунта в расширении его не зовут
      if (!silent && wallet.value) void drip.requestOnce(wallet.value.address)
    } finally {
      connecting.value = false
    }
  }

  function disconnect() {
    unsubscribe?.()
    unsubscribe = null
    wallet.value = null
    localStorage.removeItem(LAST_KEY)
  }

  async function autoConnect() {
    refresh()
    if (!listening) {
      listening = true
      const { on } = getWallets()
      on('register', refresh)
      on('unregister', refresh)
    }
    const last = localStorage.getItem(LAST_KEY)
    if (last) await connect(last, true).catch(() => localStorage.removeItem(LAST_KEY))
  }

  return { options, wallet, connecting, connect, disconnect, autoConnect, refresh }
}
