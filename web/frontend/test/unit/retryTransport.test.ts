import { SolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, type RpcTransport } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { withRetryOn429 } from '../../app/utils/retryTransport'

const http = (statusCode: number, headers = new Headers()) =>
  new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers, message: 'x', statusCode })

function fake(errors: unknown[]) {
  let calls = 0
  const transport = (async () => {
    const e = errors[calls++]
    if (e) throw e
    return 'ok'
  }) as unknown as RpcTransport
  return { transport, calls: () => calls }
}
const call = (t: RpcTransport) => t({ payload: {} })

describe('withRetryOn429', () => {
  it('retries a 429 with backoff and returns the value', async () => {
    const f = fake([http(429), http(429)])
    const delays: number[] = []
    const t = withRetryOn429(f.transport, async ms => { delays.push(ms) })
    expect(await call(t)).toBe('ok')
    expect(f.calls()).toBe(3)
    expect(delays).toEqual([500, 1_000])
  })

  it('honors Retry-After', async () => {
    const f = fake([http(429, new Headers({ 'retry-after': '3' }))])
    const delays: number[] = []
    await call(withRetryOn429(f.transport, async ms => { delays.push(ms) }))
    expect(delays).toEqual([3_000])
  })

  it('does not retry other errors', async () => {
    const f = fake([http(500)])
    await expect(call(withRetryOn429(f.transport, async () => {}))).rejects.toBeInstanceOf(SolanaError)
    expect(f.calls()).toBe(1)
  })

  it('gives up after five retries', async () => {
    const f = fake(Array(10).fill(http(429)))
    await expect(call(withRetryOn429(f.transport, async () => {}))).rejects.toBeInstanceOf(SolanaError)
    expect(f.calls()).toBe(6)
  })
})
