import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createApp } from '../server.mjs'
import { openState } from '../state.mjs'

const A = 'HQmD2eDfnR1rad38zPzrVcqa7h6iYBbvNuPTVn4ZVdDc'
const B = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const C = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const D = '8sK9npgzVtDYKbjeLxvLV2wSKM9QkuuGf15uiqfbqwUF'

// Отправитель-заглушка: сеть не нужна, поведение задаёт тест
const sender = { issuer: D, lamports: 1_000_000_000n, fail: false, delay: 0, sent: [] }
Object.assign(sender, {
  balance: async () => sender.lamports,
  async drip(to) {
    await new Promise(r => setTimeout(r, sender.delay))
    if (sender.fail) throw new Error('HTTP error (429): Too Many Requests')
    sender.sent.push(to)
    return `sig${sender.sent.length}`
  },
})

const statePath = join(mkdtempSync(join(tmpdir(), 'drip-')), 'state.json')
let server
let base
before(async () => {
  const { handle } = createApp({ sender, state: openState(statePath), lamports: 50_000_000n, tokens: 50n, origins: ['http://localhost:3000'], log: () => {} })
  server = createServer(handle)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}/api/drip`
})
after(() => server.close())

async function post(body, ip = '10.0.0.1', headers = {}) {
  const res = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.9.9.9`, ...headers }, body })
  return { status: res.status, json: await res.json(), headers: res.headers }
}

test('anything address() rejects is bad_address', async () => {
  for (const body of [undefined, 'not json', '{}', '{"address":42}', '{"address":"not-a-key"}']) {
    assert.deepEqual(await post(body, '10.0.1.1').then(r => [r.status, r.json]), [400, { error: 'bad_address' }])
  }
})

test('drips once, then answers already', async () => {
  const first = await post(JSON.stringify({ address: A }), '10.0.2.1')
  assert.equal(first.status, 200)
  assert.deepEqual(first.json, { ok: true, signature: 'sig1', sol: 0.05, tokens: 50 })
  assert.deepEqual((await post(JSON.stringify({ address: A }), '10.0.2.2')).json, { ok: true, already: true })
  assert.deepEqual(sender.sent, [A])
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).served[A].signature, 'sig1')
})

test('concurrent requests for one address wait in the queue and drip once', async () => {
  sender.delay = 50
  const [x, y] = await Promise.all([post(JSON.stringify({ address: B }), '10.0.3.1'), post(JSON.stringify({ address: B }), '10.0.3.2')])
  sender.delay = 0
  assert.deepEqual([x.json.ok, y.json.ok], [true, true])
  assert.equal([x.json, y.json].filter(j => j.already).length, 1)
  assert.equal(sender.sent.filter(a => a === B).length, 1)
})

test('the sixth request from one IP in an hour is rate_limited', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await post(JSON.stringify({ address: A }), '10.0.4.1')).status, 200)
  assert.deepEqual(await post(JSON.stringify({ address: A }), '10.0.4.1').then(r => [r.status, r.json]), [429, { error: 'rate_limited' }])
  assert.equal((await post(JSON.stringify({ address: A }), '10.0.4.2')).status, 200)
})

test('a low issuer balance is drip_empty, a failed send is rpc and the address stays unserved', async () => {
  sender.lamports = 99_999_999n
  assert.deepEqual(await post(JSON.stringify({ address: C }), '10.0.5.1').then(r => [r.status, r.json]), [503, { error: 'drip_empty' }])
  sender.lamports = 1_000_000_000n
  sender.fail = true
  assert.deepEqual(await post(JSON.stringify({ address: C }), '10.0.5.2').then(r => [r.status, r.json]), [502, { error: 'rpc' }])
  sender.fail = false
  assert.equal(typeof (await post(JSON.stringify({ address: C }), '10.0.5.3')).json.signature, 'string')
})

test('CORS headers only for configured origins', async () => {
  const pre = await fetch(base, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' } })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, GET')
  assert.equal(pre.headers.get('access-control-allow-headers'), 'Content-Type')
  assert.equal(pre.headers.get('vary'), 'Origin')
  assert.equal((await post(JSON.stringify({ address: A }), '10.0.6.1', { origin: 'http://localhost:3000' })).headers.get('access-control-allow-origin'), 'http://localhost:3000')
  assert.equal((await post(JSON.stringify({ address: A }), '10.0.6.2', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin'), null)
})

test('health reports the issuer, balance and served count', async () => {
  const res = await fetch(`${base}/health`)
  assert.deepEqual(await res.json(), { ok: true, issuer: D, balanceSol: 1, served: 3 })
})
