import { createHash } from 'node:crypto';
import { AccountRole, address, type Address, type Instruction } from '@solana/kit';

export const SECP256R1_PROGRAM = address('Secp256r1SigVerify1111111111111111111111111');
export const INSTRUCTIONS_SYSVAR = address('Sysvar1nstructions1111111111111111111111111');
export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
export const BPF_LOADER_UPGRADEABLE = address('BPFLoaderUpgradeab1e11111111111111111111111');

/** Anchor: первые 8 байт sha256("global:<snake_name>"). */
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

export function borshBytes(bytes: Uint8Array): Uint8Array {
  return concat(u32le(bytes.length), bytes);
}

export function borshString(s: string): Uint8Array {
  return borshBytes(new TextEncoder().encode(s));
}

/** Самодостаточная инструкция прекомпайла: все индексы 0xFFFF, данные с 16-го байта. */
export function secp256r1Instruction(pubkey: Uint8Array, sig: Uint8Array, msg: Uint8Array): Instruction {
  const pkOff = 16, sigOff = pkOff + 33, msgOff = sigOff + 64;
  const header = new Uint8Array(16);
  const dv = new DataView(header.buffer);
  header[0] = 1;
  header[1] = 0;
  [sigOff, 0xffff, pkOff, 0xffff, msgOff, msg.length, 0xffff].forEach((v, i) => dv.setUint16(2 + 2 * i, v, true));
  return { programAddress: SECP256R1_PROGRAM, accounts: [], data: concat(header, pubkey, sig, msg) };
}

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
  args: { pubkey: Uint8Array; spkiHash: Uint8Array; dnHash: Uint8Array; name: string; country: string },
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
      new Uint8Array([0]), // TrustKind::P256Ca
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
 *  string org_name, string org_id, 2 country, i64 ×3, u8 bump. */
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
