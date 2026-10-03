import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { address, createNoopSigner } from '@solana/kit'
import {
  getBondDecoder, getBondEventDecoder, getSnapshotDecoder, getTakeSnapshotInstructionAsync,
} from '../../app/utils/bond/generated'
import {
  bondPda, coupon, eventPda, eventStatus, eventsRecorded, formatTkzt, holderPda, paymentTs, recordTs, redeemed, snapPda,
} from '../../app/utils/bond'
import { BOND_ERRORS, SimulationError, describeError, isHookRejection } from '../../app/utils/errors'

const fx = JSON.parse(readFileSync(new URL('./fixtures/kase.json', import.meta.url), 'utf8'))
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))
const program = address(fx.program)
const mint = address(fx.mint)
const terms = {
  face: 100_000n, couponRateBps: 1_000, paymentsPerYear: 2, nEvents: 4, startTs: 1_000n,
  periodSecs: 120n, recordOffsetSecs: 30n, noticeSecs: 60n, minTrustLevel: 0,
}

describe('schedule and entitlements', () => {
  it('match the program', () => {
    expect(recordTs(terms, 1)).toBe(1_090n)
    expect(paymentTs(terms, 1)).toBe(1_120n)
    expect([1_089n, 1_090n, 1_210n, 100_000n].map(n => eventsRecorded(terms, n))).toEqual([0, 1, 2, 4])
    expect(coupon(terms, 10n)).toBe(50_000n)
    expect([10n, 7n, 3n].map(b => redeemed(b, 3_000, false))).toEqual([3n, 2n, 0n])
    expect(redeemed(7n, 0, true)).toBe(7n)
    expect(formatTkzt(1_060_000n)).toBe('10,600.00 tKZT')
  })

  it('derive the event status from the clock and the event account', () => {
    const e = { complete: true, couponTotal: 100n, principalTotal: 0n, funded: 0n, paid: 0n }
    expect(eventStatus(terms, undefined, 1, 1_089n)).toBe('scheduled')
    expect(eventStatus(terms, undefined, 1, 1_090n)).toBe('recording')
    expect(eventStatus(terms, e as never, 1, 1_090n)).toBe('complete')
    expect(eventStatus(terms, { ...e, funded: 100n } as never, 1, 1_090n)).toBe('funded')
    expect(eventStatus(terms, { ...e, funded: 100n, paid: 100n } as never, 1, 1_200n)).toBe('paid')
  })
})

describe('PDAs', () => {
  it('match what the generated client resolves', async () => {
    const tokenAccount = address(fx.holders[0].tokenAccount)
    const ix = await getTakeSnapshotInstructionAsync({ payer: createNoopSigner(address(fx.issuer)), mint, tokenAccount, k: 2 })
    const keys = ix.accounts.map(a => a.address)
    expect(keys[2]).toBe(await bondPda(program, mint))
    expect(keys[4]).toBe(await holderPda(program, mint, tokenAccount))
    expect(keys[5]).toBe(await eventPda(program, mint, 2))
    expect(keys[6]).toBe(await snapPda(program, mint, 2, tokenAccount))
  })
})

describe('reference bond from devnet', () => {
  it('decodes to a fully paid and redeemed lifecycle', () => {
    const bond = getBondDecoder().decode(bytes(fx.accounts.bond))
    expect([bond.issued, bond.outstanding]).toEqual([20n, 0n])
    const events = fx.accounts.events.map((b: string) => getBondEventDecoder().decode(bytes(b)))
    expect(events.map((e: { complete: boolean }) => e.complete)).toEqual([true, true, true, true])
    expect(events.map((e: { redemptionBps: number }) => e.redemptionBps)).toEqual([0, 3_000, 0, 0])
    for (const e of events) expect(e.paid).toBe(e.couponTotal + e.principalTotal)
    const totals = new Map<string, bigint>()
    for (const b of fx.accounts.snapshots) {
      const s = getSnapshotDecoder().decode(bytes(b))
      totals.set(s.owner, (totals.get(s.owner) ?? 0n) + s.couponDue + s.principalDue)
    }
    // A и B после перевода одной облигации на событии 2 держат по 6
    expect(fx.holders.map((h: { owner: string }) => totals.get(h.owner))).toEqual([1_060_000n, 930_000n, 360_000n])
  })
})

describe('bond errors', () => {
  const sim = (code: number) => new SimulationError({ InstructionError: [0, { Custom: code }] }, [])
  it('names hook rejections and program rejections', () => {
    expect(describeError(sim(6008), { attestorUrl: '' }))
      .toBe(`Rejected by the transfer hook: ${BOND_ERRORS[6008]} (6008). The transaction was not sent: it failed simulation`)
    expect(isHookRejection(sim(6008))).toBe(true)
    expect(describeError(sim(6010), { attestorUrl: '' }))
      .toBe(`Rejected by the bond program: ${BOND_ERRORS[6010]} (6010). The transaction was not sent: it failed simulation`)
    expect(isHookRejection(sim(6010))).toBe(false)
  })
})
