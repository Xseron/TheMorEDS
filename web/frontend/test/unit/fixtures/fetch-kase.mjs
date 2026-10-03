// Один раз снимает с devnet аккаунты готового примера облигации (mor-kase/scripts/devnet/devnet-reference.json)
import { readFileSync, writeFileSync } from 'node:fs'
import { address, createSolanaRpc, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit'

const ref = JSON.parse(readFileSync(new URL('../../../../../../mor-kase/scripts/devnet/devnet-reference.json', import.meta.url), 'utf8'))
const rpc = createSolanaRpc('https://api.devnet.solana.com')
const enc = getAddressEncoder()
const program = address(ref.program)
const mint = enc.encode(address(ref.mint))
const pda = async seeds => (await getProgramDerivedAddress({ programAddress: program, seeds }))[0]
async function get(a) {
  const { value } = await rpc.getAccountInfo(a, { encoding: 'base64' }).send()
  if (!value) throw new Error(`${a} not found on devnet`)
  return value.data[0]
}
const ks = [1, 2, 3, 4]
const accounts = {
  bond: await get(await pda(['bond', mint])),
  events: await Promise.all(ks.map(async k => get(await pda(['event', mint, new Uint8Array([k])])))),
  snapshots: await Promise.all(ref.holders.flatMap(h => ks.map(async k =>
    get(await pda(['snap', mint, new Uint8Array([k]), enc.encode(address(h.tokenAccount))]))))),
}
writeFileSync(new URL('./kase.json', import.meta.url), JSON.stringify({ ...ref, accounts }, null, 2) + '\n')
console.log('wrote kase.json')
