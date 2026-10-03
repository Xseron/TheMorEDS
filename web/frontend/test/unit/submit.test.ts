import { AccountRole, generateKeyPair, getAddressFromPublicKey, type Instruction } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { demoWallet } from '../../app/utils/demoWallet'
import { DEMO } from '../../app/utils/registry'
import { submit, type SubmitRpc } from '../../app/utils/submit'

const SIG = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi2DdyX6jbjr2SVnZqbkJsFYXwGfmQr1rFqyunWPmM7Jsnx'
const ok = <T>(value: T) => ({ send: () => Promise.resolve(value) })
const fails = () => ({ send: () => Promise.reject(new Error('HTTP error (429): Too Many Requests')) })
const confirmed = () => ok({ value: [{ err: null, confirmationStatus: 'confirmed' }] })
const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

function fakeRpc(onSend: () => void = () => {}): SubmitRpc {
  return {
    getLatestBlockhash: () => ok({ value: { blockhash: DEMO.b, lastValidBlockHeight: 1_000n } }),
    simulateTransaction: () => ok({ value: { err: null, logs: [] } }),
    sendTransaction: () => { onSend(); return ok(SIG) },
    getSignatureStatuses: confirmed,
    getBlockHeight: () => ok(900n),
  }
}

// Инструкция, которой нужна подпись нового минта
async function mintSigner() {
  const keys = await generateKeyPair()
  const ix: Instruction = { programAddress: DEMO.c, accounts: [{ address: await getAddressFromPublicKey(keys.publicKey), role: AccountRole.READONLY_SIGNER }] }
  return { keys, ix }
}

describe('submit', () => {
  it('keeps polling when a status request fails after the transaction was sent', async () => {
    const statuses = [fails(), confirmed()]
    let statusCalls = 0
    const rpc = { ...fakeRpc(), getSignatureStatuses: () => statuses[statusCalls++]! }
    await expect(submit(rpc, await demoWallet(memory()), [], async () => {})).resolves.toBe(SIG)
    expect(statusCalls).toBe(2)
  })

  it('signs with the wallet first, then with the extra signer', async () => {
    const { keys, ix } = await mintSigner()
    await expect(submit(fakeRpc(), await demoWallet(memory()), [ix], async () => {}, [keys])).resolves.toBe(SIG)
  })

  it('does not send while a signature is missing', async () => {
    const { ix } = await mintSigner()
    let sent = 0
    await expect(submit(fakeRpc(() => sent++), await demoWallet(memory()), [ix], async () => {})).rejects.toThrow(/missing signatures/)
    expect(sent).toBe(0)
  })
})
