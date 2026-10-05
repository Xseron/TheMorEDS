// Минимальный DER-разбор сертификата, зеркало programs/mor-registry/src/x509.rs

export type Tlv = { tag: number; body: Uint8Array; raw: Uint8Array; rest: Uint8Array };

export function readTlv(buf: Uint8Array): Tlv {
  if (buf.length < 2) throw new Error('DER: truncated');
  const tag = buf[0];
  let len = buf[1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('DER: unsupported length');
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[2 + i];
    header = 2 + n;
  }
  const end = header + len;
  if (end > buf.length) throw new Error('DER: truncated');
  return { tag, body: buf.subarray(header, end), raw: buf.subarray(0, end), rest: buf.subarray(end) };
}

function expect(buf: Uint8Array, tag: number): Tlv {
  const t = readTlv(buf);
  if (t.tag !== tag) throw new Error(`DER: expected tag ${tag}, got ${t.tag}`);
  return t;
}

// Полные TLV: tbs, issuer, subject, spki; у serial только содержимое INTEGER
export type CertParts = {
  tbs: Uint8Array;
  signature: Uint8Array; // ECDSA-Sig-Value DER
  serial: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  spki: Uint8Array;
  publicKey: Uint8Array; // 65 байт 0x04||X||Y
};

export function parseCertificate(der: Uint8Array): CertParts {
  const cert = expect(der, 0x30);
  const tbs = expect(cert.body, 0x30);
  const sigAlg = expect(tbs.rest, 0x30);
  const sigBits = expect(sigAlg.rest, 0x03);
  if (sigBits.body[0] !== 0) throw new Error('DER: unused bits');

  let cur = tbs.body;
  if (cur[0] === 0xa0) cur = readTlv(cur).rest; // version
  const serial = expect(cur, 0x02);
  const tbsSigAlg = expect(serial.rest, 0x30);
  const issuer = expect(tbsSigAlg.rest, 0x30);
  const validity = expect(issuer.rest, 0x30);
  const subject = expect(validity.rest, 0x30);
  const spki = expect(subject.rest, 0x30);
  const alg = expect(spki.body, 0x30);
  const keyBits = expect(alg.rest, 0x03);
  if (keyBits.body[0] !== 0) throw new Error('DER: unused bits');

  return {
    tbs: tbs.raw,
    signature: sigBits.body.subarray(1),
    serial: serial.body,
    issuer: issuer.raw,
    subject: subject.raw,
    spki: spki.raw,
    publicKey: keyBits.body.subarray(1),
  };
}

// Та же политика subject, что evaluate_certificate в программе. OID как DER-содержимое в hex
const OID_O = '55040a'; // 2.5.4.10 organizationName
const OID_ORG_ID = '550461'; // 2.5.4.97 organizationIdentifier
const PERSON_ATTRS: Record<string, string> = {
  '550404': 'surname (2.5.4.4)',
  '55042a': 'givenName (2.5.4.42)',
  '550405': 'serialNumber (2.5.4.5)',
  '550441': 'pseudonym (2.5.4.65)',
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Причина не отправлять сертификат или null; subject передаётся полным TLV Name */
export function subjectPolicyViolation(subject: Uint8Array): string | null {
  const name = expect(subject, 0x30);
  if (name.rest.length !== 0) throw new Error('DER: trailing bytes after Name');
  const oids = new Set<string>();
  for (let rdns = name.body; rdns.length > 0; ) {
    const rdn = expect(rdns, 0x31);
    rdns = rdn.rest;
    for (let atvs = rdn.body; atvs.length > 0; ) {
      const atv = expect(atvs, 0x30);
      atvs = atv.rest;
      oids.add(hex(expect(atv.body, 0x06).body));
    }
  }
  const person = Object.keys(PERSON_ATTRS).filter((oid) => oids.has(oid));
  if (person.length > 0) {
    return `subject contains natural-person attributes: ${person.map((oid) => PERSON_ATTRS[oid]).join(', ')}`;
  }
  if (!oids.has(OID_O) || !oids.has(OID_ORG_ID)) {
    return 'subject lacks organizationName (2.5.4.10) or organizationIdentifier (2.5.4.97)';
  }
  return null;
}

const P256_N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');

function toBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function to32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** ECDSA-Sig-Value DER -> 64 байта r||s big-endian, s в low-S */
export function signatureToLowS(der: Uint8Array): Uint8Array {
  const seq = expect(der, 0x30);
  const r = expect(seq.body, 0x02);
  const s = expect(r.rest, 0x02);
  let sv = toBigInt(s.body);
  if (sv > P256_N / 2n) sv = P256_N - sv;
  const out = new Uint8Array(64);
  out.set(to32(toBigInt(r.body)), 0);
  out.set(to32(sv), 32);
  return out;
}

export function compressP256(uncompressed: Uint8Array): Uint8Array {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) throw new Error('not an uncompressed P-256 point');
  const out = new Uint8Array(33);
  out[0] = 0x02 | (uncompressed[64] & 1);
  out.set(uncompressed.subarray(1, 33), 1);
  return out;
}
