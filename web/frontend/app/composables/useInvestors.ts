// Демо-инвесторы: три ключа в localStorage этого браузера, печати тестового аттестатора. Ничего не защищают.
import { attestWithTestKey, registerInstructions } from '~/utils/attestation'
import { transferSolInstruction } from '~/utils/bond'
import { demoWallet } from '~/utils/demoWallet'
import { sealPda } from '~/utils/registry'
import { submit, type Wallet } from '~/utils/submit'

export const INVESTORS = [
  { key: 'kase-investor-1', name: 'Demo Pension Fund JSC', bin: '000000000001', bonds: 10n },
  { key: 'kase-investor-2', name: 'Demo Bank JSC', bin: '000000000002', bonds: 7n },
  { key: 'kase-investor-3', name: 'Demo Insurance JSC', bin: '000000000003', bonds: 3n },
] as const

const now = () => BigInt(Math.floor(Date.now() / 1000))

export function useInvestors() {
  const { rpc, ids, accountData, testAttestorKey, send } = useSolana()
  const { wallet } = useWallet()
  const wallets = useState<Wallet[]>('kase-investors', () => [])

  async function load() {
    if (!wallets.value.length) wallets.value = await Promise.all(INVESTORS.map(i => demoWallet(localStorage, i.key, i.name)))
    return wallets.value
  }

  /** SOL от подключённого кошелька и печать тестового аттестатора тем, у кого её ещё нет */
  async function prepare(onStep: (text: string) => void) {
    const list = await load()
    const balances = await Promise.all(list.map(w => rpc.getBalance(w.address).send().then(r => r.value)))
    const poor = list.filter((_, i) => balances[i]! < 20_000_000n)
    if (poor.length) {
      onStep('Sending 0.05 SOL to each demo investor')
      await send(poor.map(w => transferSolInstruction(wallet.value!.address, w.address, 50_000_000n)))
    }
    for (const [i, w] of list.entries()) {
      const seal = await sealPda(ids, w.address)
      if (await accountData(seal)) continue
      onStep(`Sealing ${INVESTORS[i]!.name} with the test attestor`)
      const a = await attestWithTestKey(ids, testAttestorKey, w.address, INVESTORS[i]!.name, INVESTORS[i]!.bin, now())
      await submit(rpc, w, registerInstructions(ids, a, w.address, seal))
    }
  }

  return { wallets, load, prepare }
}
