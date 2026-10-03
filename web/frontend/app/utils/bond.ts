// Облигация KASE: адреса, график, суммы и инструкции вокруг программы bond_lifecycle (клиент — Codama из mor-kase)
import { AccountRole, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction } from '@solana/kit'
import type { BondEvent, Terms, TermsArgs } from './bond/generated'
import { ATA_PROGRAM, SYSTEM_PROGRAM, TOKEN_2022, concat, u32le, u64le } from './registry'

export const PAY_DECIMALS = 2

const enc = getAddressEncoder()
const b = (a: Address) => new Uint8Array(enc.encode(a))
const pda = async (program: Address, seeds: (string | Uint8Array)[]) =>
  (await getProgramDerivedAddress({ programAddress: program, seeds }))[0]

export const bondPda = (program: Address, mint: Address) => pda(program, ['bond', b(mint)])
export const vaultPda = (program: Address, mint: Address) => pda(program, ['vault', b(mint)])
export const eventPda = (program: Address, mint: Address, k: number) => pda(program, ['event', b(mint), Uint8Array.of(k)])
export const holderPda = (program: Address, mint: Address, tokenAccount: Address) => pda(program, ['holder', b(mint), b(tokenAccount)])
export const snapPda = (program: Address, mint: Address, k: number, tokenAccount: Address) =>
  pda(program, ['snap', b(mint), Uint8Array.of(k), b(tokenAccount)])
export const extraMetasPda = (program: Address, mint: Address) => pda(program, ['extra-account-metas', b(mint)])
export const ata2022 = (owner: Address, mint: Address) => pda(ATA_PROGRAM, [b(owner), b(TOKEN_2022), b(mint)])

type Schedule = Pick<Terms, 'startTs' | 'periodSecs' | 'recordOffsetSecs' | 'noticeSecs' | 'nEvents'>

// Те же формулы, что math.rs программы
export const paymentTs = (t: Schedule, k: number) => t.startTs + t.periodSecs * BigInt(k)
export const recordTs = (t: Schedule, k: number) => paymentTs(t, k) - t.recordOffsetSecs
export const noticeDeadline = (t: Schedule, k: number) => recordTs(t, k) - t.noticeSecs

export function eventsRecorded(t: Schedule, now: bigint): number {
  const elapsed = now - t.startTs + t.recordOffsetSecs
  if (elapsed < t.periodSecs) return 0
  const k = elapsed / t.periodSecs
  return Number(k < BigInt(t.nEvents) ? k : BigInt(t.nEvents))
}

export const coupon = (t: Pick<Terms, 'face' | 'couponRateBps' | 'paymentsPerYear'>, balance: bigint) =>
  balance * t.face * BigInt(t.couponRateBps) / (10_000n * BigInt(t.paymentsPerYear))
export const redeemed = (balance: bigint, bps: number, isFinal: boolean) => (isFinal ? balance : balance * BigInt(bps) / 10_000n)

export function formatTkzt(minor: bigint): string {
  return `${(minor / 100n).toLocaleString('en-US')}.${(minor % 100n).toString().padStart(2, '0')} tKZT`
}

/** Пример трека в масштабе демо: 1000.00, 10%, дважды в год, 4 события; дата выплаты через четверть периода после фиксации */
export function demoTerms(now: bigint, periodSecs: bigint): TermsArgs {
  return {
    face: 100_000n, couponRateBps: 1_000, paymentsPerYear: 2, nEvents: 4, startTs: now + 60n,
    periodSecs, recordOffsetSecs: periodSecs / 4n, noticeSecs: periodSecs / 2n, minTrustLevel: 0,
  }
}

export type EventStatus = 'scheduled' | 'recording' | 'complete' | 'funded' | 'paid'

export function eventStatus(t: Schedule, e: Pick<BondEvent, 'complete' | 'couponTotal' | 'principalTotal' | 'funded' | 'paid'> | undefined, k: number, now: bigint): EventStatus {
  if (now < recordTs(t, k)) return 'scheduled'
  if (!e?.complete) return 'recording'
  const due = e.couponTotal + e.principalTotal
  if (e.funded !== due) return 'complete'
  return e.paid === due && now >= paymentTs(t, k) ? 'paid' : 'funded'
}

const ro = (address: Address) => ({ address, role: AccountRole.READONLY })

/** Associated Token Account: CreateIdempotent (1) для любого минта Token-2022 */
export function createAta2022Instruction(payer: Address, ata: Address, owner: Address, mint: Address): Instruction {
  return {
    programAddress: ATA_PROGRAM,
    accounts: [{ address: payer, role: AccountRole.WRITABLE_SIGNER }, { address: ata, role: AccountRole.WRITABLE }, ro(owner), ro(mint), ro(SYSTEM_PROGRAM), ro(TOKEN_2022)],
    data: Uint8Array.of(1),
  }
}

/** SystemInstruction::Transfer (2) */
export function transferSolInstruction(from: Address, to: Address, lamports: bigint): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [{ address: from, role: AccountRole.WRITABLE_SIGNER }, { address: to, role: AccountRole.WRITABLE }],
    data: concat(u32le(2), u64le(lamports)),
  }
}

/** TransferChecked (12) облигации + аккаунты хука в порядке extra-account-metas программы */
export async function transferBondInstruction(
  program: Address, registry: Address, mint: Address,
  a: { source: Address; destination: Address; destinationOwner: Address; authority: Address; amount: bigint },
): Promise<Instruction> {
  const [bond, seal, holderSource, holderDestination, metas] = await Promise.all([
    bondPda(program, mint),
    pda(registry, ['seal', b(a.destinationOwner)]),
    holderPda(program, mint, a.source),
    holderPda(program, mint, a.destination),
    extraMetasPda(program, mint),
  ])
  return {
    programAddress: TOKEN_2022,
    accounts: [
      { address: a.source, role: AccountRole.WRITABLE },
      ro(mint),
      { address: a.destination, role: AccountRole.WRITABLE },
      { address: a.authority, role: AccountRole.READONLY_SIGNER },
      ...[registry, bond, seal, holderSource, holderDestination, program, metas].map(ro),
    ],
    data: concat(Uint8Array.of(12), u64le(a.amount), Uint8Array.of(0)),
  }
}
