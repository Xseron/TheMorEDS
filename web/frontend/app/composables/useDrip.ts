import { describeDripError, requestDrip } from '~/utils/drip'

export type DripStatus = 'idle' | 'funding' | 'done' | 'already' | 'error'
export type DripState = { status: DripStatus; error: string; signature: string }

const IDLE: DripState = { status: 'idle', error: '', signature: '' }
const ONCE_KEY = 'mor-drip:'

// Отметка в localStorage: при следующих подключениях этого кошелька в этом браузере кран не зовём
function marked(address: string) {
  try { return localStorage.getItem(ONCE_KEY + address) !== null } catch { return false }
}
function mark(address: string, value: string) {
  try { localStorage.setItem(ONCE_KEY + address, value) } catch { /* без хранилища кран ответит already */ }
}

export function useDrip() {
  const states = useState<Record<string, DripState>>('drip', () => ({}))
  const url = useRuntimeConfig().public.dripUrl

  const stateOf = (address?: string | null): DripState => (address ? states.value[address] : undefined) ?? IDLE

  async function request(address: string): Promise<DripStatus> {
    if (states.value[address]?.status === 'funding') return 'funding'
    states.value[address] = { ...IDLE, status: 'funding' }
    try {
      const r = await requestDrip(url, address)
      states.value[address] = r.already ? { ...IDLE, status: 'already' } : { ...IDLE, status: 'done', signature: r.signature ?? '' }
    } catch (e) {
      states.value[address] = { ...IDLE, status: 'error', error: describeDripError(e) }
    }
    return stateOf(address).status
  }

  async function requestOnce(address: string) {
    if (marked(address)) return
    const status = await request(address)
    if (status === 'done' || status === 'already') mark(address, status)
  }

  return { stateOf, request, requestOnce }
}
