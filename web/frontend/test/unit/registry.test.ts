import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AddressKind, DEMO, DEVNET_IDS, NotASeal, TrustKind, TrustLevel, ZERO_ADDRESS,
  decodeSeal, decodeTrustService, parseAddress, sealPda, shortAddress,
} from '../../app/utils/registry'

const fx = JSON.parse(readFileSync(new URL('./fixtures/devnet.json', import.meta.url), 'utf8'))
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))
const TRUST_CA = '6hpDW1GSCHnZ1HK7F1JUwm1uLWgJ77tVAiLLD7skro28'
const TRUST_ATTESTOR = 'GfmdiooMadYsqzEG6bbC6tA7RjAyCMqdjfdRMMevEFnJ'

describe('decodeSeal', () => {
  it('reads seal A: eIDAS, trustless, with a certificate', () => {
    const s = decodeSeal(bytes(fx.sealA))
    expect(s.name).toBe('Acme Robotics OÜ')
    expect(s.jurisdiction).toBe('EE')
    expect(s.kind).toBe(AddressKind.Wallet)
    expect(s.trustLevel).toBe(TrustLevel.Trustless)
    expect(s.address).toBe(DEMO.a)
    expect(s.controller).toBe(DEMO.a)
    expect(s.trustService).toBe(TRUST_CA)
    expect(s.certificate).not.toBe(ZERO_ADDRESS)
    expect(s.identifierHash).toMatch(/^[0-9a-f]{64}$/)
    expect(s.expiresAt > s.createdAt).toBe(true)
  })

  it('reads seal B: attestor, no certificate', () => {
    const s = decodeSeal(bytes(fx.sealB))
    expect(s.name).toBe('ТОО «Ромашка»')
    expect(s.jurisdiction).toBe('KZ')
    expect(s.trustLevel).toBe(TrustLevel.Attestor)
    expect(s.address).toBe(DEMO.b)
    expect(s.trustService).toBe(TRUST_ATTESTOR)
    expect(s.certificate).toBe(ZERO_ADDRESS)
  })

  it('rejects short data, a foreign discriminator and a trust-service account', () => {
    expect(() => decodeSeal(new Uint8Array(100))).toThrow(NotASeal)
    const d = bytes(fx.sealA)
    d[0] ^= 1
    expect(() => decodeSeal(d)).toThrow(NotASeal)
    expect(() => decodeSeal(bytes(fx.trustAttestor))).toThrow(NotASeal)
  })
})

describe('decodeTrustService', () => {
  it('reads the test CA and the test attestor', () => {
    expect(decodeTrustService(bytes(fx.trustCa))).toEqual({ kind: TrustKind.P256Ca, name: 'Mor Test QTSP', country: 'EE' })
    expect(decodeTrustService(bytes(fx.trustAttestor))).toEqual({ kind: TrustKind.Attestor, name: 'Mor Test Attestor', country: 'KZ' })
  })
})

describe('PDAs', () => {
  it('derives the seal PDAs of A and B', async () => {
    expect(await sealPda(DEVNET_IDS, DEMO.a)).toBe('Ah22nG415GcVA7orLVTg2gCf6gpzdWxEgFhfuACccWse')
    expect(await sealPda(DEVNET_IDS, DEMO.b)).toBe('3iQxKHRfkYLMbo4FywqzisFQVCQgWyXHENVWAvcYfjaL')
  })
})

describe('parseAddress', () => {
  it('trims whitespace and rejects junk and transaction signatures', () => {
    expect(parseAddress(`  ${DEMO.a} \n`)).toBe(DEMO.a)
    expect(parseAddress('hello')).toBeNull()
    expect(parseAddress('')).toBeNull()
    expect(parseAddress('5bPXY7YwAiMidL9cFVxbxd4xgPR7AyzmvY3jdnpCjhtDnMRCFLwy91CJPw6cgiG7BorXeiEmyj1yUjoRFLrcDnB4')).toBeNull()
  })
  it('shortens addresses for display', () => {
    expect(shortAddress(DEMO.b)).toBe('Bp75…eALw')
  })
})
