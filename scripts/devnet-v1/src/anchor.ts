import { createHash } from 'node:crypto';
import { AccountRole, address, getAddressDecoder, getAddressEncoder, type Address, type Instruction } from '@solana/kit';

export const SECP256R1_PROGRAM = address('Secp256r1SigVerify1111111111111111111111111');
export const ED25519_PROGRAM = address('Ed25519SigVerify111111111111111111111111111');

export enum TrustKind { P256Ca = 0, Attestor = 1 }
export enum AddressKind { Wallet = 0, Program = 1, Mint = 2 }
export enum TrustLevel { Attestor = 0, Trustless = 1 }
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
export const BPF_LOADER_UPGRADEABLE = address('BPFLoaderUpgradeab1e11111111111111111111111');

/** Anchor: первые 8 байт sha256("global:<snake_name>") */
export function discriminator(name: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`global:${name}`).digest()).subarray(0, 8);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

export function i64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, n, true);
  return b;
}

const addressBytes = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));

export function borshBytes(bytes: Uint8Array): Uint8Array {
  return concat(u32le(bytes.length), bytes);
}

export function borshString(s: string): Uint8Array {
  return borshBytes(new TextEncoder().encode(s));
}

/** Самодостаточная инструкция прекомпайла: все индексы 0xFFFF, ключ с 16-го байта, затем подпись и сообщение */
function precompileInstruction(program: Address, pubkey: Uint8Array, sig: Uint8Array, msg: Uint8Array): Instruction {
  const pkOff = 16, sigOff = pkOff + pubkey.length, msgOff = sigOff + 64;
  const header = new Uint8Array(16);
  const dv = new DataView(header.buffer);
  header[0] = 1;
  header[1] = 0;
  [sigOff, 0xffff, pkOff, 0xffff, msgOff, msg.length, 0xffff].forEach((v, i) => dv.setUint16(2 + 2 * i, v, true));
  return { programAddress: program, accounts: [], data: concat(header, pubkey, sig, msg) };
}

export const secp256r1Instruction = (pubkey: Uint8Array, sig: Uint8Array, msg: Uint8Array) =>
  precompileInstruction(SECP256R1_PROGRAM, pubkey, sig, msg);

export const ed25519Instruction = (pubkey: Uint8Array, sig: Uint8Array, msg: Uint8Array) =>
  precompileInstruction(ED25519_PROGRAM, pubkey, sig, msg);

export function initializeInstruction(program: Address, admin: Address, config: Address, programData: Address): Instruction {
  return {
    programAddress: program,
    accounts: [
      { address: admin, role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.WRITABLE },
      { address: program, role: AccountRole.READONLY },
      { address: programData, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: discriminator('initialize'),
  };
}

export function addTrustServiceInstruction(
  program: Address,
  admin: Address,
  config: Address,
  trustService: Address,
  args: { kind?: TrustKind; pubkey: Uint8Array; spkiHash: Uint8Array; dnHash: Uint8Array; name: string; country: string },
): Instruction {
  return {
    programAddress: program,
    accounts: [
      { address: admin, role: AccountRole.WRITABLE_SIGNER },
      { address: config, role: AccountRole.READONLY },
      { address: trustService, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(
      discriminator('add_trust_service'),
      new Uint8Array([args.kind ?? TrustKind.P256Ca]),
      args.pubkey,
      args.spkiHash,
      args.dnHash,
      borshString(args.name),
      new TextEncoder().encode(args.country),
    ),
  };
}

export function registerCertificateInstruction(
  program: Address,
  payer: Address,
  trustService: Address,
  certificate: Address,
  serial: Uint8Array,
): Instruction {
  return {
    programAddress: program,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: trustService, role: AccountRole.READONLY },
      { address: certificate, role: AccountRole.WRITABLE },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(discriminator('register_certificate'), borshBytes(serial)),
  };
}

/** Раскладка Certificate: 8 disc, 32 trust_service, vec serial, 32 tbs_hash, 33 subject_key,
 *  string org_name, string org_id, 2 country, i64 x3, u8 bump */
export function decodeCertificate(data: Uint8Array) {
  const dv = new DataView(data.buffer, data.byteOffset);
  let o = 8;
  const hex = (n: number) => { const s = Buffer.from(data.subarray(o, o + n)).toString('hex'); o += n; return s; };
  const bytes = () => { const n = dv.getUint32(o, true); o += 4; return hex(n); };
  const str = () => { const n = dv.getUint32(o, true); o += 4; const s = new TextDecoder().decode(data.subarray(o, o + n)); o += n; return s; };
  const i64 = () => { const v = dv.getBigInt64(o, true); o += 8; return new Date(Number(v) * 1000).toISOString(); };
  return {
    trustService: hex(32),
    serial: bytes(),
    tbsHash: hex(32),
    subjectKey: hex(33),
    orgName: str(),
    orgId: str(),
    country: new TextDecoder().decode(data.subarray(o, (o += 2))),
    notBefore: i64(),
    notAfter: i64(),
    registeredAt: i64(),
  };
}

export type SealMessageFields = {
  program: Address;
  address: Address;
  kind: AddressKind;
  controller: Address;
  trustLevel: TrustLevel;
  trustService: Address;
  certificate: Address | null; // у аттестатора null, в сообщении 32 нулевых байта
  jurisdiction: string; // 2 буквы ISO 3166-1
  identifierHash: Uint8Array;
  expiresAt: bigint;
  signDeadline: bigint;
  name: string;
};

/** Байт в байт как SealMessage::to_bytes в programs/mor-registry/src/seal_message.rs */
export function sealMessage(f: SealMessageFields): Uint8Array {
  const name = new TextEncoder().encode(f.name);
  if (name.length < 1 || name.length > 128) throw new Error('seal name must be 1..128 UTF-8 bytes');
  return concat(
    new TextEncoder().encode('MOR-SEAL-V1'),
    addressBytes(f.program),
    addressBytes(f.address),
    new Uint8Array([f.kind]),
    addressBytes(f.controller),
    new Uint8Array([f.trustLevel]),
    addressBytes(f.trustService),
    f.certificate ? addressBytes(f.certificate) : new Uint8Array(32),
    new TextEncoder().encode(f.jurisdiction),
    new Uint8Array([0]), // SubjectType::LegalEntity
    f.identifierHash,
    i64le(f.expiresAt),
    i64le(f.signDeadline),
    new Uint8Array([name.length]),
    name,
  );
}

type SealAccounts = {
  controller: Address;
  address: Address;
  programData: Address | null; // Option<Account>: None передаётся адресом программы
  trustService: Address;
  seal: Address;
  kind: AddressKind;
  expiresAt: bigint;
  signDeadline: bigint;
};

export function registerSealP256Instruction(
  program: Address,
  a: SealAccounts & { certificate: Address; salt: Uint8Array },
): Instruction {
  return {
    programAddress: program,
    accounts: [
      { address: a.controller, role: AccountRole.WRITABLE_SIGNER },
      { address: a.address, role: AccountRole.READONLY },
      { address: a.programData ?? program, role: AccountRole.READONLY },
      { address: a.trustService, role: AccountRole.READONLY },
      { address: a.certificate, role: AccountRole.READONLY },
      { address: a.seal, role: AccountRole.WRITABLE },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(discriminator('register_seal_p256'), new Uint8Array([a.kind]), a.salt, i64le(a.expiresAt), i64le(a.signDeadline)),
  };
}

export function registerSealAttestedInstruction(
  program: Address,
  a: SealAccounts & { identifierHash: Uint8Array; name: string },
): Instruction {
  return {
    programAddress: program,
    accounts: [
      { address: a.controller, role: AccountRole.WRITABLE_SIGNER },
      { address: a.address, role: AccountRole.READONLY },
      { address: a.programData ?? program, role: AccountRole.READONLY },
      { address: a.trustService, role: AccountRole.READONLY },
      { address: a.seal, role: AccountRole.WRITABLE },
      { address: INSTRUCTIONS_SYSVAR, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(
      discriminator('register_seal_attested'),
      new Uint8Array([a.kind]),
      a.identifierHash,
      borshString(a.name),
      i64le(a.expiresAt),
      i64le(a.signDeadline),
    ),
  };
}

export function revokeSealInstruction(
  program: Address,
  a: { signer: Address; address: Address; programData: Address | null; seal: Address },
): Instruction {
  return {
    programAddress: program,
    accounts: [
      { address: a.signer, role: AccountRole.WRITABLE_SIGNER },
      { address: a.address, role: AccountRole.READONLY },
      { address: a.programData ?? program, role: AccountRole.READONLY },
      { address: a.seal, role: AccountRole.WRITABLE },
    ],
    data: discriminator('revoke_seal'),
  };
}

/** Поля Seal по фиксированным смещениям, название с 190 */
export function decodeSeal(d: Uint8Array) {
  const dv = new DataView(d.buffer, d.byteOffset);
  const dec = getAddressDecoder();
  const key = (o: number) => dec.decode(d.subarray(o, o + 32));
  const time = (o: number) => new Date(Number(dv.getBigInt64(o, true)) * 1000).toISOString();
  const nameLen = dv.getUint32(190, true);
  return {
    address: key(8),
    kind: AddressKind[d[40]],
    controller: key(41),
    trustLevel: TrustLevel[d[73]],
    jurisdiction: new TextDecoder().decode(d.subarray(74, 76)),
    identifierHash: Buffer.from(d.subarray(77, 109)).toString('hex'),
    trustService: key(109),
    certificate: key(141),
    expiresAt: time(173),
    createdAt: time(181),
    name: new TextDecoder().decode(d.subarray(194, 194 + nameLen)),
  };
}
