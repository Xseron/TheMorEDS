// NCALayer на машине пользователя: присоединённая CAdES через commonUtils, как ждёт аттестатор
import { getBase64Decoder } from '@solana/kit'
import { NcaCancelled, NcaUnavailable } from './errors'
import { utf8 } from './registry'

export const NCA_URL = 'wss://127.0.0.1:13579/'

export function signWithNcaLayer(text: string, url = NCA_URL, WS: typeof WebSocket = WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false
    const ws = new WS(url)
    const finish = (f: () => void) => { if (done) return; done = true; f(); ws.close() }
    ws.onerror = () => finish(() => reject(new NcaUnavailable()))
    ws.onclose = () => finish(() => reject(new NcaUnavailable()))
    ws.onopen = () => ws.send(JSON.stringify({
      module: 'kz.gov.pki.knca.commonUtils',
      method: 'createCAdESFromBase64',
      args: ['PKCS12', 'SIGNATURE', getBase64Decoder().decode(utf8(text)), true],
    }))
    ws.onmessage = (ev) => {
      let m: { result?: { version?: string }; code?: string; responseObject?: string; message?: string }
      try { m = JSON.parse(String(ev.data)) } catch { return }
      if (m.result?.version) return // приветствие NCALayer
      if (m.code === '200' && typeof m.responseObject === 'string') return finish(() => resolve(m.responseObject!))
      finish(() => reject(/cancel/i.test(m.message ?? '') ? new NcaCancelled() : new Error(`NCALayer: ${m.message ?? m.code ?? 'unexpected reply'}`)))
    }
  })
}
