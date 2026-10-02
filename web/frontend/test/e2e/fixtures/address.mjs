import { readFileSync } from 'node:fs'
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey } from '@solana/kit'

const { seed } = JSON.parse(readFileSync(new URL('./wallet.json', import.meta.url), 'utf8'))
const keyPair = await createKeyPairFromPrivateKeyBytes(Uint8Array.from(seed.match(/.{2}/g).map(x => parseInt(x, 16))))
console.log(await getAddressFromPublicKey(keyPair.publicKey))
