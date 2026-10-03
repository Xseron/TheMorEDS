import { describe, expect, it } from 'vitest'
import { DripError, requestDrip } from '../../app/utils/drip'

const DRIP_URL = 'https://morseal.ink/api/drip'
const ADDRESS = '2bh2EWPzbNXLdXsa74i6sQzUSxyJdhjEzFVXfmN4f2zr'
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch

describe('requestDrip', () => {
  it('posts the address and maps the contract to a result or a DripError', async () => {
    const calls: [string, RequestInit][] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(JSON.stringify({ ok: true, signature: 'sig', sol: 0.05, tokens: 50 }), { status: 200 })
    }) as typeof fetch
    await expect(requestDrip(DRIP_URL, ADDRESS, fake)).resolves.toEqual({ already: false, signature: 'sig' })
    expect(calls[0]![0]).toBe(DRIP_URL)
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ address: ADDRESS })

    await expect(requestDrip(DRIP_URL, ADDRESS, reply(200, { ok: true, already: true }))).resolves.toEqual({ already: true })
    await expect(requestDrip(DRIP_URL, ADDRESS, reply(429, { error: 'rate_limited' }))).rejects.toMatchObject({ code: 'rate_limited' })
    const offline = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    await expect(requestDrip(DRIP_URL, ADDRESS, offline)).rejects.toSatisfy((e: unknown) => e instanceof DripError && e.code === 'unreachable')
  })
})
