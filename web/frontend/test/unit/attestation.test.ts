import { address } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import {
  attestWithTestKey, encodeAttestResponse, parseAttestResponse, registerInstructions, requestText, validateCompany, verifyAttestation,
} from '../../app/utils/attestation'
import { DEMO, DEVNET_IDS, fromHex, hex } from '../../app/utils/registry'

// fixtures/keys/attestor.json, TEST-ONLY
const KEY = fromHex('c5ef593e369d8cdab85c485061cc1160741c6d26f3da2404036b0efaffce7abdc0f567f08b7db041cd8b8a6696d73bc0e2ade1cd9c92d4aedd92e52f5cc40c68')
const ATTESTOR = address('DzEKM1bBSwg199FtSeqmeo7x2HD3kaCn7XBR7FvQcDmy')
const TRUST = address('GfmdiooMadYsqzEG6bbC6tA7RjAyCMqdjfdRMMevEFnJ')
const NOW = 1_790_000_000n

describe('requestText', () => {
  it('is exactly seven lines with LF and no trailing newline', () => {
    const { text, expires, deadline } = requestText(DEVNET_IDS, DEMO.c, NOW)
    expect(text.split('\n')).toEqual([
      'MOR-SEAL-REQUEST-V1', `program: ${DEVNET_IDS.registry}`, `address: ${DEMO.c}`, 'kind: wallet', `controller: ${DEMO.c}`, `expires: ${expires}`, `deadline: ${deadline}`,
    ])
    expect(expires).toBe(NOW + 365n * 86_400n)
    expect(deadline).toBe(NOW + 600n)
  })
})

describe('validateCompany', () => {
  it('limits the name in bytes and the BIN to 12 digits', () => {
    expect(() => validateCompany('Ж'.repeat(64), '123456789012')).not.toThrow()
    expect(() => validateCompany('Ж'.repeat(65), '123456789012')).toThrow(/128 bytes/)
    expect(() => validateCompany('', '123456789012')).toThrow(/128 bytes/)
    expect(() => validateCompany('Demo LLP', '12345')).toThrow(/12 digits/)
  })
})

describe('test attestor', () => {
  it('produces an attestation that verifies against the devnet trust service', async () => {
    const a = await attestWithTestKey(DEVNET_IDS, KEY, DEMO.c, 'Demo LLP', '123456789012', NOW)
    expect(a.attestor).toBe(ATTESTOR)
    expect(a.trustService).toBe(TRUST)
    expect(a.salt.length).toBe(32)
    expect(a.bin).toBe('123456789012')
    await expect(verifyAttestation(DEVNET_IDS, a, DEMO.c, ATTESTOR, NOW + 10n)).resolves.toBeUndefined()
    const ixs = registerInstructions(DEVNET_IDS, a, DEMO.c, DEMO.a)
    expect(ixs).toHaveLength(2)
    expect(ixs[0].programAddress).toBe('Ed25519SigVerify111111111111111111111111111')
  })

  it('rejects another owner, a stale deadline, a tampered message and an unknown attestor', async () => {
    const a = await attestWithTestKey(DEVNET_IDS, KEY, DEMO.c, 'Demo LLP', '123456789012', NOW)
    await expect(verifyAttestation(DEVNET_IDS, a, DEMO.b, ATTESTOR, NOW)).rejects.toThrow(/not for this wallet/)
    await expect(verifyAttestation(DEVNET_IDS, a, DEMO.c, ATTESTOR, NOW + 601n)).rejects.toThrow(/expired/)
    await expect(verifyAttestation(DEVNET_IDS, a, DEMO.c, DEMO.a, NOW)).rejects.toThrow(/unknown attestor/)
    const forged = { ...a, signature: new Uint8Array(a.signature) }
    forged.signature[0] ^= 1
    await expect(verifyAttestation(DEVNET_IDS, forged, DEMO.c, ATTESTOR, NOW)).rejects.toThrow(/does not verify/)
    const salted = { ...a, salt: new Uint8Array(a.salt) }
    salted.salt[0] ^= 1
    await expect(verifyAttestation(DEVNET_IDS, salted, DEMO.c, ATTESTOR, NOW)).rejects.toThrow(/salt/)
  })

  it('round-trips through the attestor JSON shape', async () => {
    const a = await attestWithTestKey(DEVNET_IDS, KEY, DEMO.c, 'Demo LLP', '123456789012', NOW)
    const r = encodeAttestResponse(a)
    expect(r.salt).toBe(hex(a.salt))
    expect(typeof r.message).toBe('string')
    const back = parseAttestResponse(r)
    expect(hex(back.message)).toBe(hex(a.message))
    expect(hex(back.signature)).toBe(hex(a.signature))
    expect(back.expiresAt).toBe(a.expiresAt)
    expect(back.trustService).toBe(a.trustService)
  })
})
