import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AccountRole, getAddressDecoder } from '@solana/kit'
import {
  AddressKind, DEMO, DEVNET_IDS, DISCRIMINATORS, INSTRUCTIONS_SYSVAR, NotASeal, SYSTEM_PROGRAM, TOKEN_2022, TrustKind, TrustLevel, ZERO_ADDRESS,
  createAtaIdempotentInstruction, decodeSeal, decodeTrustService, ed25519Instruction, hex, parseAddress, registerSealAttestedInstruction, revokeSealInstruction, sealMessage, sealPda, sha256, shortAddress, transferCheckedInstruction, utf8,
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
    // длина имени по смещению 190: больше 128 и за концом буфера
    const long = bytes(fx.sealA)
    new DataView(long.buffer).setUint32(190, 129, true)
    expect(() => decodeSeal(long)).toThrow(NotASeal)
    const past = bytes(fx.sealA)
    new DataView(past.buffer).setUint32(190, past.length, true)
    expect(() => decodeSeal(past)).toThrow(NotASeal)
    // аккаунт дополнен нулями до 322 байт, поэтому границу буфера проверяем обрезкой: имя 17 байт, данных на 16
    expect(() => decodeSeal(bytes(fx.sealA).subarray(0, 194 + 16))).toThrow(NotASeal)
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

// Эталон из спеки аттестатора: layout_matches_spec_offsets, 250 байт
const VECTOR
  = '4d4f522d5345414c2d5631afe3ef75354d140f003334108037ea07df2cfdad47b65d62fa7a5d78f63d0fb0'
    + '0101010101010101010101010101010101010101010101010101010101010101' + '02'
    + '0202020202020202020202020202020202020202020202020202020202020202' + '01'
    + '0303030303030303030303030303030303030303030303030303030303030303'
    + '0404040404040404040404040404040404040404040404040404040404040404'
    + '4b5a' + '00'
    + '0505050505050505050505050505050505050505050505050505050505050505'
    + '0807060504030201' + 'ffffffffffffffff'
    + '19d0a2d09ed09e20c2abd0a0d0bed0bcd0b0d188d0bad0b0c2bb'

const filled = (v: number) => new Uint8Array(32).fill(v)
const addr = (v: number) => getAddressDecoder().decode(filled(v))

describe('sealMessage', () => {
  it('matches the known-answer vector byte for byte', async () => {
    const msg = sealMessage({
      program: DEVNET_IDS.registry, address: addr(1), kind: AddressKind.Mint, controller: addr(2),
      trustLevel: TrustLevel.Trustless, trustService: addr(3), certificate: addr(4), jurisdiction: 'KZ',
      identifierHash: filled(5), expiresAt: 0x0102030405060708n, signDeadline: -1n, name: 'ТОО «Ромашка»',
    })
    expect(hex(msg)).toBe(VECTOR)
    expect(hex(await sha256(msg))).toBe('41672e1455b594791f5bf302171b05f2de12063730d12a707bcc738a8b18213b')
  })

  it('counts the name limit in bytes, not characters', () => {
    const f = { program: DEVNET_IDS.registry, address: addr(1), kind: AddressKind.Wallet, controller: addr(1), trustLevel: TrustLevel.Attestor, trustService: addr(3), certificate: null, jurisdiction: 'KZ', identifierHash: filled(5), expiresAt: 1n, signDeadline: 1n }
    expect(() => sealMessage({ ...f, name: 'Ж'.repeat(64) })).not.toThrow()
    expect(() => sealMessage({ ...f, name: 'Ж'.repeat(65) })).toThrow(/128/)
    expect(() => sealMessage({ ...f, name: '' })).toThrow(/128/)
  })
})

describe('instructions', () => {
  it('uses the Anchor discriminators', async () => {
    const disc = async (n: string) => hex((await sha256(utf8(`global:${n}`))).subarray(0, 8))
    expect(hex(DISCRIMINATORS.registerSealAttested)).toBe(await disc('register_seal_attested'))
    expect(hex(DISCRIMINATORS.revokeSeal)).toBe(await disc('revoke_seal'))
  })

  it('builds a self-contained Ed25519 precompile instruction', () => {
    const ix = ed25519Instruction(filled(7), new Uint8Array(64).fill(8), utf8('abc'))
    expect(ix.accounts).toEqual([])
    expect([...ix.data!.subarray(0, 16)]).toEqual([1, 0, 48, 0, 255, 255, 16, 0, 255, 255, 112, 0, 3, 0, 255, 255])
    expect(ix.data!.length).toBe(16 + 32 + 64 + 3)
  })

  it('lays out register_seal_attested', () => {
    const ix = registerSealAttestedInstruction(DEVNET_IDS, {
      controller: DEMO.b, address: DEMO.b, trustService: addr(3), seal: addr(9), kind: AddressKind.Wallet,
      identifierHash: filled(5), name: 'Demo LLP', expiresAt: 1_800_000_000n, signDeadline: 1_700_000_000n,
    })
    expect(ix.programAddress).toBe(DEVNET_IDS.registry)
    expect(ix.accounts!.map(a => a.address)).toEqual([DEMO.b, DEMO.b, DEVNET_IDS.registry, addr(3), addr(9), INSTRUCTIONS_SYSVAR, SYSTEM_PROGRAM])
    expect(ix.accounts![0].role).toBe(AccountRole.WRITABLE_SIGNER)
    expect(ix.accounts![4].role).toBe(AccountRole.WRITABLE)
    const d = ix.data!
    expect(hex(d.subarray(0, 8))).toBe(hex(DISCRIMINATORS.registerSealAttested))
    expect(d[8]).toBe(0)
    expect(hex(d.subarray(9, 41))).toBe(hex(filled(5)))
    expect([...d.subarray(41, 45)]).toEqual([8, 0, 0, 0])
    expect(new TextDecoder().decode(d.subarray(45, 53))).toBe('Demo LLP')
    expect(d.length).toBe(53 + 16)
  })

  it('lays out revoke_seal with the program in place of program_data', () => {
    const ix = revokeSealInstruction(DEVNET_IDS, { signer: DEMO.b, address: DEMO.b, seal: addr(9) })
    expect(ix.accounts!.map(a => a.address)).toEqual([DEMO.b, DEMO.b, DEVNET_IDS.registry, addr(9)])
    expect(hex(ix.data!)).toBe(hex(DISCRIMINATORS.revokeSeal))
  })

  it('lays out TransferChecked with the hook accounts in order', () => {
    const ix = transferCheckedInstruction(DEVNET_IDS, {
      source: addr(1), destination: addr(2), authority: DEMO.b, amount: 1n, policy: addr(3), recipientSeal: addr(4), extraMetas: addr(5),
    })
    expect(ix.programAddress).toBe(TOKEN_2022)
    expect(ix.accounts!.map(a => a.address)).toEqual([addr(1), DEVNET_IDS.mint, addr(2), DEMO.b, DEVNET_IDS.registry, addr(3), addr(4), DEVNET_IDS.hook, addr(5)])
    expect(ix.accounts![3].role).toBe(AccountRole.READONLY_SIGNER)
    expect([...ix.data!]).toEqual([12, 1, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('lays out CreateIdempotent for the ATA', () => {
    const ix = createAtaIdempotentInstruction(DEVNET_IDS, DEMO.b, addr(6), DEMO.c)
    expect(ix.accounts!.map(a => a.address)).toEqual([DEMO.b, addr(6), DEMO.c, DEVNET_IDS.mint, SYSTEM_PROGRAM, TOKEN_2022])
    expect([...ix.data!]).toEqual([1])
  })
})
