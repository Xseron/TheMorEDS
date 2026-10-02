// Один раз снимает с devnet байты печатей A и B и их траст-сервисов для unit-тестов
import { writeFileSync } from 'node:fs'
import { createSolanaRpc } from '@solana/kit'

const rpc = createSolanaRpc('https://api.devnet.solana.com')
const accounts = {
  sealA: 'Ah22nG415GcVA7orLVTg2gCf6gpzdWxEgFhfuACccWse',
  sealB: '3iQxKHRfkYLMbo4FywqzisFQVCQgWyXHENVWAvcYfjaL',
  trustCa: '6hpDW1GSCHnZ1HK7F1JUwm1uLWgJ77tVAiLLD7skro28',
  trustAttestor: 'GfmdiooMadYsqzEG6bbC6tA7RjAyCMqdjfdRMMevEFnJ',
}
const out = {}
for (const [name, address] of Object.entries(accounts)) {
  const { value } = await rpc.getAccountInfo(address, { encoding: 'base64' }).send()
  if (!value) throw new Error(`${name} ${address} not found on devnet`)
  out[name] = value.data[0]
}
writeFileSync(new URL('./devnet.json', import.meta.url), JSON.stringify(out, null, 2))
console.log('wrote', Object.keys(out).join(', '))
