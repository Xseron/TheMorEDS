import { describe, expect, it } from 'vitest'
import { DEMO } from '../../app/utils/registry'
import { submit, type SubmitRpc } from '../../app/utils/submit'

const SIG = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi2DdyX6jbjr2SVnZqbkJsFYXwGfmQr1rFqyunWPmM7Jsnx'
const ok = <T>(value: T) => ({ send: () => Promise.resolve(value) })
const fails = () => ({ send: () => Promise.reject(new Error('HTTP error (429): Too Many Requests')) })

describe('submit', () => {
  it('keeps polling when a status request fails after the transaction was sent', async () => {
    const statuses = [fails(), ok({ value: [{ err: null, confirmationStatus: 'confirmed' }] })]
    let statusCalls = 0
    const rpc: SubmitRpc = {
      getLatestBlockhash: () => ok({ value: { blockhash: DEMO.b, lastValidBlockHeight: 1_000n } }),
      simulateTransaction: () => ok({ value: { err: null, logs: [] } }),
      sendTransaction: () => ok(SIG),
      getSignatureStatuses: () => statuses[statusCalls++]!,
      getBlockHeight: () => ok(900n),
    }
    const wallet = { name: 'test', address: DEMO.a, signTransaction: async (wire: Uint8Array) => wire }
    await expect(submit(rpc, wallet, [], async () => {})).resolves.toBe(SIG)
    expect(statusCalls).toBe(2)
  })
})
