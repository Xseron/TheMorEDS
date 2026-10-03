// Кран devnet для демо-кошельков сайта: SOL и демо-токены на адрес, один раз на адрес
import { realpathSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { address } from '@solana/kit'
import { createSender, loadKeyPair } from './solana.mjs'
import { openState } from './state.mjs'

const MIN_BALANCE = 100_000_000n
const HOUR = 3_600_000
const BODY_LIMIT = 4096

export function config(env = process.env) {
  return {
    key: env.DRIP_KEY || '/etc/morseal/issuer.json',
    rpc: env.DRIP_RPC || 'https://api.devnet.solana.com',
    mint: address(env.DRIP_MINT || 'HQmD2eDfnR1rad38zPzrVcqa7h6iYBbvNuPTVn4ZVdDc'),
    port: Number(env.DRIP_PORT || 8790),
    lamports: BigInt(env.DRIP_SOL || '50000000'),
    tokens: BigInt(env.DRIP_TOKENS || '50'),
    state: env.DRIP_STATE || './drip-state.json',
    origins: (env.DRIP_ORIGINS || 'https://morseal.ink,http://localhost:3000,http://localhost:3001').split(',').map(s => s.trim()).filter(Boolean),
  }
}

// Скользящее окно в памяти; после перезапуска счёт начинается заново
function limiter(limit, windowMs) {
  const hits = new Map()
  return (key, now) => {
    if (hits.size > 10_000) for (const [k, ts] of hits) if (now - ts[ts.length - 1] >= windowMs) hits.delete(k)
    const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
    const ok = recent.length < limit
    if (ok) recent.push(now)
    hits.set(key, recent)
    return ok
  }
}

const oneLine = e => [e?.message ?? String(e), e?.cause?.message].filter(Boolean).join(': ').replace(/\s+/g, ' ').slice(0, 400)

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size <= BODY_LIMIT) chunks.push(c) })
    req.on('end', () => resolve(size <= BODY_LIMIT ? Buffer.concat(chunks).toString('utf8') : ''))
    req.on('error', reject)
  })
}

function parseAddress(body) {
  try {
    const a = JSON.parse(body)?.address
    return typeof a === 'string' ? address(a) : null
  } catch {
    return null
  }
}

export function createApp({ sender, state, lamports, tokens, origins, now = Date.now, log = console.log }) {
  const perIp = limiter(5, HOUR)
  const daily = limiter(300, 24 * HOUR)
  const amounts = { sol: Number(lamports) / 1e9, tokens: Number(tokens) }
  // Выдачи строго по одной: две транзакции не делят blockhash и не гоняются за балансом
  let queue = Promise.resolve()
  const serial = (fn) => {
    const run = queue.then(fn)
    queue = run.catch(() => {})
    return run
  }

  async function drip(ip, body) {
    if (!perIp(ip, now())) return { status: 429, json: { error: 'rate_limited' } }
    const to = parseAddress(body)
    if (!to) return { status: 400, json: { error: 'bad_address' } }
    if (state.has(to)) return { status: 200, json: { ok: true, already: true }, to }
    if (!daily('all', now())) return { status: 429, json: { error: 'rate_limited' }, to }
    return serial(async () => {
      // Пока запрос ждал очереди, этот адрес мог уже получить выдачу
      if (state.has(to)) return { status: 200, json: { ok: true, already: true }, to }
      let signature
      try {
        if ((await sender.balance()) < MIN_BALANCE) return { status: 503, json: { error: 'drip_empty' }, to }
        signature = await sender.drip(to)
      } catch (e) {
        return { status: 502, json: { error: 'rpc' }, to, note: oneLine(e) }
      }
      let note = signature
      try { state.add(to, signature) } catch (e) { note += ` state not saved: ${oneLine(e)}` }
      return { status: 200, json: { ok: true, signature, ...amounts }, to, note }
    })
  }

  async function health() {
    try {
      const balance = await sender.balance()
      return { status: 200, json: { ok: true, issuer: sender.issuer, balanceSol: Number(balance) / 1e9, served: state.size } }
    } catch (e) {
      return { status: 502, json: { error: 'rpc' }, note: oneLine(e) }
    }
  }

  async function handle(req, res) {
    const headers = { 'vary': 'Origin' }
    const origin = req.headers.origin
    if (origin && origins.includes(origin)) headers['access-control-allow-origin'] = origin
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '-'
    const path = new URL(req.url ?? '/', 'http://drip').pathname.replace(/\/+$/, '')
    const known = path === '/api/drip' || path === '/api/drip/health'
    let r
    try {
      if (req.method === 'OPTIONS' && known) {
        if (headers['access-control-allow-origin']) {
          headers['access-control-allow-methods'] = 'POST, GET'
          headers['access-control-allow-headers'] = 'Content-Type'
          headers['access-control-max-age'] = '86400'
        }
        r = { status: 204 }
      } else if (req.method === 'POST' && path === '/api/drip') {
        r = await drip(ip, await readBody(req))
      } else if (req.method === 'GET' && path === '/api/drip/health') {
        r = await health()
      } else {
        r = { status: known ? 405 : 404, json: { error: known ? 'method' : 'not_found' } }
      }
    } catch (e) {
      r = { status: 500, json: { error: 'internal' }, note: oneLine(e) }
    }
    if (r.json) headers['content-type'] = 'application/json'
    res.writeHead(r.status, headers)
    res.end(r.json ? JSON.stringify(r.json) : undefined)
    const result = r.json?.error ?? (r.json?.already ? 'already' : r.status === 204 ? 'preflight' : 'ok')
    log(`${new Date(now()).toISOString()} ${ip} ${req.method} ${path} ${r.to ?? '-'} ${r.status} ${result}${r.note ? ` ${r.note}` : ''}`)
  }

  return { handle }
}

async function main() {
  const cfg = config()
  const { keyPair, issuer } = await loadKeyPair(cfg.key)
  const sender = createSender({ rpcUrl: cfg.rpc, keyPair, issuer, mint: cfg.mint, lamports: cfg.lamports, tokens: cfg.tokens })
  const { handle } = createApp({ sender, state: openState(cfg.state), lamports: cfg.lamports, tokens: cfg.tokens, origins: cfg.origins })
  const server = createServer(handle)
  server.listen(cfg.port, '127.0.0.1', () => {
    console.log(`${new Date().toISOString()} drip issuer ${issuer} mint ${cfg.mint} on 127.0.0.1:${cfg.port}, rpc ${new URL(cfg.rpc).host}`)
  })
  const stop = () => {
    server.close()
    server.closeIdleConnections()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

// Запуск напрямую или из pm2: у pm2 argv[1] указывает на его обёртку, путь скрипта в pm_exec_path
const entry = process.env.pm_exec_path || process.argv[1]
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main().catch((e) => {
    console.error(`${new Date().toISOString()} drip failed to start: ${oneLine(e)}`)
    process.exit(1)
  })
}
