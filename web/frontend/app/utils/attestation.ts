// Аттестация: подписанное аттестатором сообщение печати и поля к нему. Два источника: Go-аттестатор
// через NCALayer и тестовый ключ в браузере. Дальше путь общий.
import {
  createKeyPairFromBytes, getAddressFromPublicKey, getBase64Decoder, getBase64Encoder, getPublicKeyFromAddress, signBytes, verifySignature,
  type Address, type Instruction, type SignatureBytes,
} from '@solana/kit'
import { AttestorError } from './errors'
import {
  AddressKind, TrustLevel, addressBytes, ed25519Instruction, fromHex, hex, registerSealAttestedInstruction, sealMessage, sha256, trustPda, utf8,
  type Ids,
} from './registry'

export interface Attestation {
  message: Uint8Array
  signature: Uint8Array
  attestor: Address
  trustService: Address
  name: string
  bin?: string
  salt: Uint8Array
  identifierHash: Uint8Array
  expiresAt: bigint
  signDeadline: bigint
}

// Ответ POST /v1/attest, как в спеке аттестатора
export type AttestResponse = {
  message: string; signature: string; attestor: string; trustService: string
  name: string; bin: string; salt: string; identifierHash: string; expiresAt: number; signDeadline: number
}

export const YEAR = 365n * 86_400n
export const DEADLINE = 600n

export function requestText(ids: Ids, owner: Address, now: bigint) {
  const expires = now + YEAR
  const deadline = now + DEADLINE
  const text = ['MOR-SEAL-REQUEST-V1', `program: ${ids.registry}`, `address: ${owner}`, 'kind: wallet', `controller: ${owner}`, `expires: ${expires}`, `deadline: ${deadline}`].join('\n')
  return { text, expires, deadline }
}

export function validateCompany(name: string, bin: string) {
  const n = utf8(name).length
  if (n < 1 || n > 128) throw new Error('The company name must be 1 to 128 bytes')
  if (!/^\d{12}$/.test(bin)) throw new Error('The BIN must be exactly 12 digits')
}

const fields = (ids: Ids, owner: Address, a: Pick<Attestation, 'trustService' | 'identifierHash' | 'expiresAt' | 'signDeadline' | 'name'>) => ({
  program: ids.registry, address: owner, kind: AddressKind.Wallet, controller: owner, trustLevel: TrustLevel.Attestor,
  trustService: a.trustService, certificate: null, jurisdiction: 'KZ', identifierHash: a.identifierHash,
  expiresAt: a.expiresAt, signDeadline: a.signDeadline, name: a.name,
})

export async function attestWithTestKey(ids: Ids, key64: Uint8Array, owner: Address, name: string, bin: string, now: bigint): Promise<Attestation> {
  validateCompany(name, bin)
  const keyPair = await createKeyPairFromBytes(key64)
  const attestor = await getAddressFromPublicKey(keyPair.publicKey)
  const trustService = await trustPda(ids, await sha256(key64.subarray(32)))
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const identifierHash = await sha256(salt, utf8('KZ'), utf8(bin))
  const { expires, deadline } = requestText(ids, owner, now)
  const partial = { trustService, identifierHash, expiresAt: expires, signDeadline: deadline, name }
  const message = sealMessage(fields(ids, owner, partial))
  const signature = new Uint8Array(await signBytes(keyPair.privateKey, message))
  return { message, signature, attestor, trustService, name, bin, salt, identifierHash, expiresAt: expires, signDeadline: deadline }
}

const b64ToBytes = (s: string) => new Uint8Array(getBase64Encoder().encode(s))
const bytesToB64 = (b: Uint8Array) => getBase64Decoder().decode(b)

export function parseAttestResponse(r: AttestResponse): Attestation {
  return {
    message: b64ToBytes(r.message), signature: b64ToBytes(r.signature),
    attestor: r.attestor as Address, trustService: r.trustService as Address,
    name: r.name, bin: r.bin, salt: fromHex(r.salt), identifierHash: fromHex(r.identifierHash),
    expiresAt: BigInt(r.expiresAt), signDeadline: BigInt(r.signDeadline),
  }
}

export function encodeAttestResponse(a: Attestation): AttestResponse {
  return {
    message: bytesToB64(a.message), signature: bytesToB64(a.signature), attestor: a.attestor, trustService: a.trustService,
    name: a.name, bin: a.bin ?? '', salt: hex(a.salt), identifierHash: hex(a.identifierHash),
    expiresAt: Number(a.expiresAt), signDeadline: Number(a.signDeadline),
  }
}

export async function postAttest(attestorUrl: string, cms: string, fetchFn: typeof fetch = fetch): Promise<Attestation> {
  const res = await fetchFn(`${attestorUrl}/v1/attest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cms }) })
  let body: Partial<AttestResponse> & { error?: string; message?: string } = {}
  try { body = await res.json() } catch { /* не JSON, ниже станет ошибкой по статусу */ }
  if (!res.ok || !body.message || !body.signature) throw new AttestorError(body.error ?? `http_${res.status}`, res.status, body.message ?? '')
  return parseAttestResponse(body as AttestResponse)
}

const same = (x: Uint8Array, y: Uint8Array) => x.length === y.length && x.every((b, i) => b === y[i])

// Всё, что можно проверить до окна кошелька: испорченный ответ ловится здесь, а не падением в сети
export async function verifyAttestation(ids: Ids, a: Attestation, owner: Address, expectedAttestor: Address, now: bigint): Promise<void> {
  if (a.attestor !== expectedAttestor) throw new Error('The attestation is signed by an unknown attestor')
  if (now > a.signDeadline) throw new Error('The attestation has expired. Sign again')
  if (!same(sealMessage(fields(ids, owner, a)), a.message)) throw new Error('The attestation is not for this wallet and registry')
  if (a.bin && !same(await sha256(a.salt, utf8('KZ'), utf8(a.bin)), a.identifierHash)) throw new Error('The salt does not match the identifier hash')
  if (a.trustService !== await trustPda(ids, await sha256(addressBytes(a.attestor)))) throw new Error('The trust service does not match the attestor key')
  const ok = await verifySignature(await getPublicKeyFromAddress(a.attestor), a.signature as SignatureBytes, a.message)
  if (!ok) throw new Error('The attestor signature does not verify')
}

export function registerInstructions(ids: Ids, a: Attestation, owner: Address, seal: Address): Instruction[] {
  return [
    ed25519Instruction(addressBytes(a.attestor), a.signature, a.message),
    registerSealAttestedInstruction(ids, {
      controller: owner, address: owner, trustService: a.trustService, seal, kind: AddressKind.Wallet,
      identifierHash: a.identifierHash, name: a.name, expiresAt: a.expiresAt, signDeadline: a.signDeadline,
    }),
  ]
}
