// Чистые кодеки реестра Mör: адреса, PDA, разбор аккаунтов. Без сети и без Nuxt.
import {
  address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress,
  type Address,
} from '@solana/kit'

export type Ids = { registry: Address; hook: Address; mint: Address }

export const DEVNET_IDS: Ids = {
  registry: address('CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP'),
  hook: address('2A8chB6zt4LCsiiks5NrY3DceHvAVqWkAmMdNpyFkhz2'),
  mint: address('HQmD2eDfnR1rad38zPzrVcqa7h6iYBbvNuPTVn4ZVdDc'),
}
export const TOKEN_2022 = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const SYSTEM_PROGRAM = address('11111111111111111111111111111111')
export const ZERO_ADDRESS = SYSTEM_PROGRAM
export const ED25519_PROGRAM = address('Ed25519SigVerify111111111111111111111111111')
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111')

// Демо-кошельки devnet: эмитент токена, A (Acme, eIDAS), B (ТОО «Ромашка», аттестатор), C (без печати)
export const DEMO = {
  issuer: address('8sK9npgzVtDYKbjeLxvLV2wSKM9QkuuGf15uiqfbqwUF'),
  a: address('DERFemCQSFg6G5QDQDL7mvYonpz1PZAa3ySbYxCD5GmF'),
  b: address('Bp75o5N39Zs2Qz7xseSSHVEKT8yAw8YEVxTQ48ZBeALw'),
  c: address('5kSUuRK5wM5LN4SsGekAzk9mGQ78zRnpsMsq3skWP3eu'),
}
// Их ключи опубликованы в репозитории, выписка помечает их как TEST
export const TEST_TRUST_SERVICES: Address[] = [
  address('6hpDW1GSCHnZ1HK7F1JUwm1uLWgJ77tVAiLLD7skro28'),
  address('GfmdiooMadYsqzEG6bbC6tA7RjAyCMqdjfdRMMevEFnJ'),
]

export enum AddressKind { Wallet = 0, Program = 1, Mint = 2 }
export enum TrustLevel { Attestor = 0, Trustless = 1 }
export enum TrustKind { P256Ca = 0, Attestor = 1 }

export const utf8 = (s: string) => new TextEncoder().encode(s)
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
export function u32le(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b }
export function i64le(n: bigint): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, n, true); return b }
export function u64le(n: bigint): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b }
export const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
export const fromHex = (s: string) => Uint8Array.from(s.match(/.{2}/g) ?? [], x => parseInt(x, 16))
export const sha256 = async (...parts: Uint8Array[]) => new Uint8Array(await crypto.subtle.digest('SHA-256', concat(...parts)))
export const addressBytes = (a: Address) => new Uint8Array(getAddressEncoder().encode(a))
export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

export function parseAddress(text: string): Address | null {
  try { return address(text.trim()) } catch { return null }
}

const pda = async (programAddress: Address, seeds: (Uint8Array | string)[]) =>
  (await getProgramDerivedAddress({ programAddress, seeds }))[0]
export const sealPda = (ids: Ids, owner: Address) => pda(ids.registry, ['seal', addressBytes(owner)])
export const trustPda = (ids: Ids, spkiHash: Uint8Array) => pda(ids.registry, ['trust', spkiHash])
export const policyPda = (ids: Ids) => pda(ids.hook, ['policy', addressBytes(ids.mint)])
export const extraMetasPda = (ids: Ids) => pda(ids.hook, ['extra-account-metas', addressBytes(ids.mint)])
export const ataOf = (ids: Ids, owner: Address) =>
  pda(ATA_PROGRAM, [addressBytes(owner), addressBytes(TOKEN_2022), addressBytes(ids.mint)])

// Раскладка Seal из programs/mor-registry/src/state.rs, смещения как в crates/mor-verify-seal
export const SEAL_DISCRIMINATOR = [162, 149, 250, 10, 100, 125, 36, 168]
export const SEAL_MIN_LEN = 194
export class NotASeal extends Error {}

export type Seal = {
  address: Address
  kind: AddressKind
  controller: Address
  trustLevel: TrustLevel
  jurisdiction: string
  subjectType: number
  identifierHash: string
  trustService: Address
  certificate: Address
  expiresAt: bigint
  createdAt: bigint
  name: string
}

export function decodeSeal(d: Uint8Array): Seal {
  if (d.length < SEAL_MIN_LEN || !SEAL_DISCRIMINATOR.every((b, i) => d[i] === b)) throw new NotASeal('not a seal account')
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const nameLen = dv.getUint32(190, true)
  if (nameLen > 128 || d.length < SEAL_MIN_LEN + nameLen) throw new NotASeal('seal name out of bounds')
  const key = (o: number) => getAddressDecoder().decode(d.subarray(o, o + 32))
  return {
    address: key(8),
    kind: d[40] as AddressKind,
    controller: key(41),
    trustLevel: d[73] as TrustLevel,
    jurisdiction: new TextDecoder().decode(d.subarray(74, 76)),
    subjectType: d[76],
    identifierHash: hex(d.subarray(77, 109)),
    trustService: key(109),
    certificate: key(141),
    expiresAt: dv.getBigInt64(173, true),
    createdAt: dv.getBigInt64(181, true),
    name: new TextDecoder().decode(d.subarray(194, 194 + nameLen)),
  }
}

// TrustService: 8 disc, 1 kind, 33 pubkey, 32 spki_hash, 32 dn_hash, string name, 2 country
export type TrustService = { kind: TrustKind; name: string; country: string }

export function decodeTrustService(d: Uint8Array): TrustService {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength)
  const nameLen = dv.getUint32(106, true)
  return {
    kind: d[8] as TrustKind,
    name: new TextDecoder().decode(d.subarray(110, 110 + nameLen)),
    country: new TextDecoder().decode(d.subarray(110 + nameLen, 112 + nameLen)),
  }
}
