// Чистые кодеки реестра Mör: адреса, PDA, разбор аккаунтов. Без сети и без Nuxt
import {
  address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress,
  type Address, AccountRole, type Instruction,
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

// Демо-кошельки devnet: эмитент токена, A (Acme, eIDAS), B (ТОО "Ромашка", аттестатор), C (без печати)
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
export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
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
    subjectType: d[76]!,
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

// sha256("global:<name>")[0..8], посчитано заранее; тест сверяет
export const DISCRIMINATORS = {
  registerSealAttested: Uint8Array.of(7, 232, 40, 100, 33, 134, 52, 167),
  revokeSeal: Uint8Array.of(188, 60, 180, 173, 242, 76, 128, 31),
}

export const borshString = (s: string) => { const b = utf8(s); return concat(u32le(b.length), b) }

export type SealMessageFields = {
  program: Address
  address: Address
  kind: AddressKind
  controller: Address
  trustLevel: TrustLevel
  trustService: Address
  certificate: Address | null // у аттестатора null: 32 нулевых байта
  jurisdiction: string
  identifierHash: Uint8Array
  expiresAt: bigint
  signDeadline: bigint
  name: string
}

// Байт в байт как SealMessage::to_bytes в programs/mor-registry/src/seal_message.rs
export function sealMessage(f: SealMessageFields): Uint8Array {
  const name = utf8(f.name)
  if (name.length < 1 || name.length > 128) throw new Error('the company name must be 1 to 128 UTF-8 bytes')
  return concat(
    utf8('MOR-SEAL-V1'), addressBytes(f.program), addressBytes(f.address), Uint8Array.of(f.kind),
    addressBytes(f.controller), Uint8Array.of(f.trustLevel), addressBytes(f.trustService),
    f.certificate ? addressBytes(f.certificate) : new Uint8Array(32),
    utf8(f.jurisdiction), Uint8Array.of(0), f.identifierHash, i64le(f.expiresAt), i64le(f.signDeadline),
    Uint8Array.of(name.length), name,
  )
}

const ro = (a: Address) => ({ address: a, role: AccountRole.READONLY })

// Самодостаточная инструкция прекомпайла: все индексы 0xFFFF, ключ с 16-го байта, затем подпись и сообщение
export function ed25519Instruction(pubkey: Uint8Array, sig: Uint8Array, msg: Uint8Array): Instruction {
  const header = new Uint8Array(16)
  const dv = new DataView(header.buffer)
  header[0] = 1
  ;[48, 0xffff, 16, 0xffff, 112, msg.length, 0xffff].forEach((v, i) => dv.setUint16(2 + 2 * i, v, true))
  return { programAddress: ED25519_PROGRAM, accounts: [], data: concat(header, pubkey, sig, msg) }
}

export function registerSealAttestedInstruction(ids: Ids, a: {
  controller: Address; address: Address; trustService: Address; seal: Address; kind: AddressKind
  identifierHash: Uint8Array; name: string; expiresAt: bigint; signDeadline: bigint
}): Instruction {
  return {
    programAddress: ids.registry,
    accounts: [
      { address: a.controller, role: AccountRole.WRITABLE_SIGNER },
      ro(a.address),
      ro(ids.registry), // Option<program_data> = None передаётся адресом программы
      ro(a.trustService),
      { address: a.seal, role: AccountRole.WRITABLE },
      ro(INSTRUCTIONS_SYSVAR),
      ro(SYSTEM_PROGRAM),
    ],
    data: concat(DISCRIMINATORS.registerSealAttested, Uint8Array.of(a.kind), a.identifierHash, borshString(a.name), i64le(a.expiresAt), i64le(a.signDeadline)),
  }
}

export function revokeSealInstruction(ids: Ids, a: { signer: Address; address: Address; seal: Address }): Instruction {
  return {
    programAddress: ids.registry,
    accounts: [
      { address: a.signer, role: AccountRole.WRITABLE_SIGNER },
      ro(a.address),
      ro(ids.registry),
      { address: a.seal, role: AccountRole.WRITABLE },
    ],
    data: DISCRIMINATORS.revokeSeal,
  }
}

// Associated Token Account: CreateIdempotent (1)
export function createAtaIdempotentInstruction(ids: Ids, payer: Address, ata: Address, owner: Address): Instruction {
  return {
    programAddress: ATA_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      ro(owner), ro(ids.mint), ro(SYSTEM_PROGRAM), ro(TOKEN_2022),
    ],
    data: Uint8Array.of(1),
  }
}

// TransferChecked (12), decimals 0, плюс аккаунты хука в том порядке, в каком их ждёт sealed-transfer
export function transferCheckedInstruction(ids: Ids, a: {
  source: Address; destination: Address; authority: Address; amount: bigint
  policy: Address; recipientSeal: Address; extraMetas: Address
}): Instruction {
  return {
    programAddress: TOKEN_2022,
    accounts: [
      { address: a.source, role: AccountRole.WRITABLE },
      ro(ids.mint),
      { address: a.destination, role: AccountRole.WRITABLE },
      { address: a.authority, role: AccountRole.READONLY_SIGNER },
      ro(ids.registry), ro(a.policy), ro(a.recipientSeal), ro(ids.hook), ro(a.extraMetas),
    ],
    data: concat(Uint8Array.of(12), u64le(a.amount), Uint8Array.of(0)),
  }
}
