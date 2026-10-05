// Кран devnet (web/drip): SOL и демо-токены на новый кошелёк, один раз на адрес
export type DripCode = 'rate_limited' | 'drip_empty' | 'rpc' | 'unreachable' | 'bad_address'

export class DripError extends Error {
  constructor(public readonly code: DripCode) { super(`drip: ${code}`) }
}

export const DRIP_ERRORS: Record<DripCode, string> = {
  rate_limited: 'Too many requests from this network. Try again in an hour',
  drip_empty: 'The faucet wallet is out of devnet SOL. Ask @dtorossyan on Telegram',
  rpc: 'Devnet did not confirm the funding transaction. Try again',
  unreachable: 'The faucet is not reachable. Use the commands below',
  bad_address: 'This is not a Solana address',
}

export const describeDripError = (e: unknown) => DRIP_ERRORS[e instanceof DripError ? e.code : 'unreachable']

const isCode = (c: unknown): c is DripCode => typeof c === 'string' && c in DRIP_ERRORS

export async function requestDrip(url: string, address: string, fetchFn: typeof fetch = fetch): Promise<{ already: boolean; signature?: string }> {
  let body: { ok?: boolean; already?: boolean; signature?: string; error?: string }
  try {
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })
    body = await res.json()
  } catch {
    // Сеть, CORS или не JSON (страница nginx вместо сервиса): для посетителя всё это "кран недоступен"
    throw new DripError('unreachable')
  }
  if (body?.ok) return body.already ? { already: true } : { already: false, signature: body.signature }
  throw new DripError(isCode(body?.error) ? body.error : 'unreachable')
}
