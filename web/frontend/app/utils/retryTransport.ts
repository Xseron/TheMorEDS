// Публичный RPC отвечает 429 до обработки запроса, поэтому повтор безопасен для любого метода, включая sendTransaction
import { isSolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, type RpcTransport } from '@solana/kit'

export const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000]
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export function withRetryOn429(transport: RpcTransport, sleep: (ms: number) => Promise<void> = wait): RpcTransport {
  return (async <T>(config: Parameters<RpcTransport>[0]): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await transport<T>(config)
      } catch (e) {
        if (attempt >= RETRY_DELAYS_MS.length || !isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) || e.context.statusCode !== 429) throw e
        // Retry-After в секундах, если сервер его прислал
        const after = Number(e.context.headers?.get?.('retry-after'))
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1_000, 15_000) : RETRY_DELAYS_MS[attempt]!)
      }
    }
  }) as RpcTransport
}
