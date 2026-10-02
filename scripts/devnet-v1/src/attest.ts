// Печать демо-кошелька D через Go-аттестатор НУЦ РК (attestor/).
//   npm run devnet:attest -- request         — создаёт D и пишет текст запроса в ~/.config/solana/mor-demo/d-request.txt
//   npm run devnet:attest -- submit <файл>   — по ответу аттестатора (JSON): v1-транзакция [Ed25519, register_seal_attested]
//                                              от D, затем перевод демо-токена на D — хук его пропускает
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { address, getAddressEncoder, type Address } from '@solana/kit';
import * as ix from './anchor.js';
import * as tok from './token.js';
import { DEMO, PROGRAM_ID, connect, demoKey, sha256, utf8 } from './devnet.js';

const DAY = 86_400n;
const REQUEST = join(DEMO, 'd-request.txt');

/** Ответ POST /v1/attest. */
type AttestResponse = {
  message: string; // base64
  signature: string; // base64
  attestor: string;
  trustService: string;
  name: string;
  bin: string;
  salt: string; // hex
  identifierHash: string; // hex
  expiresAt: number;
  signDeadline: number;
};

async function request() {
  const d = await demoKey('d');
  const now = BigInt(Math.floor(Date.now() / 1000));
  const text = [
    'MOR-SEAL-REQUEST-V1',
    `program: ${PROGRAM_ID}`,
    `address: ${d.address}`,
    'kind: wallet',
    `controller: ${d.address}`,
    `expires: ${now + 180n * DAY}`,
    `deadline: ${now + 600n}`,
  ].join('\n');
  writeFileSync(REQUEST, text);
  console.log(`D = ${d.address}`);
  console.log(`request: ${REQUEST} — sign it and get the attestor response within 10 minutes`);
}

async function submit(path: string) {
  for (const name of ['d', 'mint']) {
    if (!existsSync(join(DEMO, `${name}.json`))) throw new Error(`no demo key ${name}: run devnet:seal and devnet:attest -- request first`);
  }
  const r: AttestResponse = JSON.parse(readFileSync(path, 'utf8'));
  const { rpc, payer, program, hook, bytesOf, pda, account, sealOf, sendV0, sendV1 } = await connect();
  const d = await demoKey('d');
  const trustService = address(r.trustService);
  const identifierHash = new Uint8Array(Buffer.from(r.identifierHash, 'hex'));
  const expiresAt = BigInt(r.expiresAt);
  const signDeadline = BigInt(r.signDeadline);
  const message = new Uint8Array(Buffer.from(r.message, 'base64'));
  const signature = new Uint8Array(Buffer.from(r.signature, 'base64'));

  // Ответ должен быть про D и этот реестр: сообщение из полей ответа совпадает с подписанным.
  const expected = ix.sealMessage({
    program,
    address: d.address,
    kind: ix.AddressKind.Wallet,
    controller: d.address,
    trustLevel: ix.TrustLevel.Attestor,
    trustService,
    certificate: null,
    jurisdiction: 'KZ',
    identifierHash,
    expiresAt,
    signDeadline,
    name: r.name,
  });
  if (!Buffer.from(expected).equals(Buffer.from(message))) throw new Error('attestor response is not for wallet D and this registry');
  if (!Buffer.from(sha256(Buffer.from(r.salt, 'hex'), utf8('KZ'), utf8(r.bin))).equals(Buffer.from(identifierHash)))
    throw new Error('identifierHash != sha256(salt ‖ KZ ‖ BIN)');
  if (!(await account(trustService))) throw new Error(`attestor ${trustService} is not registered: run npm run devnet:seal first`);

  const sealD = await sealOf(d.address);
  if (await account(sealD)) console.log('D already sealed', sealD);
  else {
    const { value } = await rpc.getBalance(d.address).send();
    if (value < 20_000_000n) await sendV0(`fund ${d.address}`, payer, [tok.transferSolInstruction(payer.address, d.address, 50_000_000n)]);
    await sendV1('register_seal_attested (D, NCA attestor)', d, [
      ix.ed25519Instruction(new Uint8Array(getAddressEncoder().encode(address(r.attestor))), signature, message),
      ix.registerSealAttestedInstruction(program, {
        controller: d.address,
        address: d.address,
        programData: null,
        trustService,
        seal: sealD,
        kind: ix.AddressKind.Wallet,
        identifierHash,
        name: r.name,
        expiresAt,
        signDeadline,
      }),
    ]);
  }

  // Перевод демо-токена на D: у D теперь печать уровня Attestor, хук пропускает.
  const mint = (await demoKey('mint')).address;
  if (!(await account(mint))) throw new Error(`demo mint ${mint} not found: run npm run devnet:seal first`);
  const extraMetas = await pda(['extra-account-metas', bytesOf(mint)], hook);
  const policy = await pda(['policy', bytesOf(mint)], hook);
  const ata = (owner: Address) => pda([bytesOf(owner), bytesOf(tok.TOKEN_2022), bytesOf(mint)], tok.ATA_PROGRAM);
  const [ataIssuer, ataD] = await Promise.all([ata(payer.address), ata(d.address)]);
  await sendV0('transfer → D (NCA attestor seal)', payer, [
    tok.createAtaIdempotentInstruction(payer.address, ataD, d.address, mint),
    tok.transferCheckedInstruction(ataIssuer, mint, ataD, payer.address, 1n, 0, [program, policy, sealD, hook, extraMetas]),
  ]);
  console.log('seal D', sealD, ix.decodeSeal((await account(sealD))!));
}

const [cmd, arg] = process.argv.slice(2);
const run =
  cmd === 'request' ? request() : cmd === 'submit' && arg ? submit(arg) : Promise.reject(new Error('usage: devnet:attest -- request | submit <attestor-response.json>'));
run.catch((e) => {
  console.error(e);
  process.exit(1);
});
