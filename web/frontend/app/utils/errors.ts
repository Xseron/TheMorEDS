// Ошибки трёх источников (симуляция, кошелёк, аттестатор) и их текст для страницы

export class SimulationError extends Error {
  constructor(public readonly err: unknown, public readonly logs: string[]) { super('transaction failed simulation') }
}
export class OnChainError extends Error {
  constructor(public readonly signature: string, public readonly err: unknown) { super('transaction failed on-chain') }
}
export class ExpiredError extends Error { constructor() { super('blockhash expired') } }
export class WalletRejected extends Error { constructor() { super('rejected in the wallet') } }
export class AttestorError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) { super(message || code) }
}
export class NcaUnavailable extends Error { constructor() { super('NCALayer unavailable') } }
export class NcaCancelled extends Error { constructor() { super('cancelled in NCALayer') } }

// Коды mor-verify-seal: ERROR_BASE 9100 + SealError
export const HOOK_ERRORS: Record<number, string> = {
  9100: 'recipient has no seal',
  9101: 'the seal does not belong to the recipient',
  9102: "the recipient's seal has expired",
  9103: "the recipient's trust level is below what this token requires",
}

export const ATTESTOR_ERRORS: Record<string, string> = {
  bad_signature: 'The signature did not verify against the NCA root',
  revoked: 'The certificate is revoked',
  cert_not_valid_now: 'The certificate is not valid today',
  not_legal_entity: 'This certificate belongs to an individual, not a company',
  role_not_allowed: 'Only the head of the company or an employee with signing rights can seal',
  no_bin: 'The certificate has no BIN',
  no_org_name: 'The certificate has no company name',
  wrong_program: 'The request does not match this registry. Reload the page',
  bad_request_text: 'The request does not match this registry. Reload the page',
  deadline_out_of_window: 'The request has expired. Sign again',
  expires_in_past: 'The request has expired. Sign again',
}

export function customErrorCode(err: unknown, logs: string[] = []): number | null {
  const custom = (err as { InstructionError?: [number, { Custom?: number }] })?.InstructionError?.[1]?.Custom
  if (typeof custom === 'number') return custom
  for (const l of logs) {
    const m = /custom program error: 0x([0-9a-f]+)/i.exec(l)
    if (m) return parseInt(m[1]!, 16)
  }
  return null
}

export function isHookRejection(e: unknown): e is SimulationError {
  return e instanceof SimulationError && HOOK_ERRORS[customErrorCode(e.err, e.logs) ?? -1] !== undefined
}

export function describeError(e: unknown, ctx: { attestorUrl: string }): string {
  if (e instanceof SimulationError) {
    const code = customErrorCode(e.err, e.logs)
    if (code !== null && HOOK_ERRORS[code]) return `Rejected by the transfer hook: ${HOOK_ERRORS[code]} (${code}). The transaction was not sent: it failed simulation`
    if (e.err === 'AccountNotFound') return 'This wallet has no SOL on devnet'
    return `The transaction failed simulation: ${JSON.stringify(e.err)}`
  }
  if (e instanceof WalletRejected) return 'Cancelled in the wallet'
  if (e instanceof ExpiredError) return 'The transaction expired before it was confirmed. Try again'
  if (e instanceof OnChainError) return `The transaction failed on-chain: ${JSON.stringify(e.err)}`
  if (e instanceof AttestorError) return ATTESTOR_ERRORS[e.code] ?? `The attestor refused: ${e.code}`
  if (e instanceof NcaUnavailable) return 'NCALayer is not running. Start it and try again'
  if (e instanceof NcaCancelled) return 'Cancelled in NCALayer'
  if (e instanceof TypeError && /fetch/i.test(e.message)) return `The attestor is not reachable at ${ctx.attestorUrl}. Start it: attestor serve --cors-origin http://localhost:3000`
  const any = e as { code?: number; message?: string }
  const message = any?.message ?? String(e)
  if (any?.code === 4001 || /user rejected/i.test(message)) return 'Cancelled in the wallet'
  return message
}
