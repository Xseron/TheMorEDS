import { createPrivateKey, randomBytes, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addSignersToInstruction, createKeyPairFromBytes, signBytes, type Address } from '@solana/kit';
import { compressP256, parseCertificate, signatureToLowS } from './der.js';
import * as ix from './anchor.js';
import * as tok from './token.js';
import { DEMO, ROOT, connect, demoKey, hex, sha256, utf8 } from './devnet.js';

const BIN = '123456789012'; // тестовый БИН демо-организации
const ROMASHKA = 'ТОО «Ромашка»';
const DAY = 86_400n;
const NOT_SEALED = 9100; // mor-verify-seal: SealError::NotSealed

async function main() {
  const { rpc, payer, program, hook, bytesOf, pda, account, sealOf, sendV0, sendV1, sendRejected } = await connect();

  console.log('payer   ', payer.address);
  console.log('registry', program);
  console.log('hook    ', hook);

  const ca = parseCertificate(new Uint8Array(readFileSync(join(ROOT, 'fixtures/ca1.der'))));
  const caTrust = await pda(['trust', sha256(ca.spki)]);
  const ee = parseCertificate(new Uint8Array(readFileSync(join(ROOT, 'fixtures/ee_large.der'))));
  const certificate = await pda(['cert', bytesOf(caTrust), ee.serial]);
  const certData = await account(certificate);
  if (!certData) throw new Error(`certificate ${certificate} is not registered: run \`npm run devnet\` first`);
  const cert = ix.decodeCertificate(certData);

  // Ключ аттестатора только для тестов и демо
  const attestorBytes = new Uint8Array(JSON.parse(readFileSync(join(ROOT, 'fixtures/keys/attestor.json'), 'utf8')));
  const attestor = await createKeyPairFromBytes(attestorBytes);
  const attestorPub = attestorBytes.subarray(32);
  const attestorSpki = sha256(attestorPub);
  const attTrust = await pda(['trust', attestorSpki]);
  if (await account(attTrust)) console.log('attestor already registered', attTrust);
  else
    await sendV0('add_trust_service (attestor)', payer, [
      ix.addTrustServiceInstruction(program, payer.address, await pda(['config']), attTrust, {
        kind: ix.TrustKind.Attestor,
        pubkey: ix.concat(attestorPub, new Uint8Array([0])),
        spkiHash: attestorSpki,
        dnHash: new Uint8Array(32),
        name: 'Mor Test Attestor',
        country: 'KZ',
      }),
    ]);

  // A: Acme (eIDAS), B: Ромашка (аттестатор), C: без печати
  const [a, b, c, mint] = await Promise.all(['a', 'b', 'c', 'mint'].map(demoKey));
  for (const w of [a, b]) {
    const { value } = await rpc.getBalance(w.address).send();
    if (value < 20_000_000n) await sendV0(`fund ${w.address}`, payer, [tok.transferSolInstruction(payer.address, w.address, 50_000_000n)]);
  }

  // Ключ сертификата Acme подписывает сообщение, A подписывает транзакцию
  const sealAPda = await sealOf(a.address);
  async function sealA(label: string) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const deadline = now + 600n;
    const salt = new Uint8Array(randomBytes(32));
    const notAfter = BigInt(Date.parse(cert.notAfter) / 1000);
    const expiresAt = now + 180n * DAY < notAfter ? now + 180n * DAY : notAfter;
    const msg = ix.sealMessage({
      program,
      address: a.address,
      kind: ix.AddressKind.Wallet,
      controller: a.address,
      trustLevel: ix.TrustLevel.Trustless,
      trustService: caTrust,
      certificate,
      jurisdiction: cert.country,
      identifierHash: sha256(salt, utf8(cert.country), utf8(cert.orgId)),
      expiresAt,
      signDeadline: deadline,
      name: cert.orgName,
    });
    const der = sign('sha256', msg, { key: createPrivateKey(readFileSync(join(ROOT, 'fixtures/keys/ee.key'))), dsaEncoding: 'der' });
    await sendV1(label, a, [
      ix.secp256r1Instruction(compressP256(ee.publicKey), signatureToLowS(new Uint8Array(der)), msg),
      ix.registerSealP256Instruction(program, {
        controller: a.address,
        address: a.address,
        programData: null,
        trustService: caTrust,
        certificate,
        seal: sealAPda,
        kind: ix.AddressKind.Wallet,
        salt,
        expiresAt,
        signDeadline: deadline,
      }),
    ]);
  }
  if (await account(sealAPda)) console.log('A already sealed', sealAPda);
  else await sealA('register_seal_p256 (A, eIDAS)');

  // В сеть попадает только sha256(соль || KZ || БИН)
  const sealB = await sealOf(b.address);
  if (await account(sealB)) console.log('B already sealed', sealB);
  else {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const deadline = now + 600n;
    const salt = new Uint8Array(randomBytes(32));
    const identifierHash = sha256(salt, utf8('KZ'), utf8(BIN));
    // Соль нужна владельцу, чтобы раскрыть БИН. В лог её не выводим, а файл пишем только
    // при создании печати, чтобы не затереть соль существующей
    const saltPath = join(DEMO, 'b-salt.hex');
    mkdirSync(DEMO, { recursive: true });
    writeFileSync(saltPath, hex(salt) + '\n', { mode: 0o600 });
    console.log(`B: BIN salt saved to ${saltPath} (the owner keeps it to disclose the BIN off-chain)`);
    const expiresAt = now + 180n * DAY;
    const msg = ix.sealMessage({
      program,
      address: b.address,
      kind: ix.AddressKind.Wallet,
      controller: b.address,
      trustLevel: ix.TrustLevel.Attestor,
      trustService: attTrust,
      certificate: null,
      jurisdiction: 'KZ',
      identifierHash,
      expiresAt,
      signDeadline: deadline,
      name: ROMASHKA,
    });
    const sig = new Uint8Array(await signBytes(attestor.privateKey, msg));
    await sendV1('register_seal_attested (B, attestor)', b, [
      ix.ed25519Instruction(attestorPub, sig, msg),
      ix.registerSealAttestedInstruction(program, {
        controller: b.address,
        address: b.address,
        programData: null,
        trustService: attTrust,
        seal: sealB,
        kind: ix.AddressKind.Wallet,
        identifierHash,
        name: ROMASHKA,
        expiresAt,
        signDeadline: deadline,
      }),
    ]);
  }

  // Хук пускает переводы только владельцам с печатью уровня Attestor и выше
  const extraMetas = await pda(['extra-account-metas', bytesOf(mint.address)], hook);
  const policy = await pda(['policy', bytesOf(mint.address)], hook);
  if (await account(mint.address)) console.log('mint already created', mint.address);
  else {
    const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(tok.MINT_WITH_HOOK_LEN)).send();
    await sendV0('create mint with transfer hook', payer, [
      addSignersToInstruction(
        [mint],
        tok.createAccountInstruction(payer.address, mint.address, rent, tok.MINT_WITH_HOOK_LEN, tok.TOKEN_2022),
      ),
      tok.initializeTransferHookInstruction(mint.address, payer.address, hook),
      tok.initializeMint2Instruction(mint.address, 0, payer.address),
    ]);
  }
  if (await account(extraMetas)) console.log('hook already initialized for the mint');
  else
    await sendV0('sealed-transfer initialize', payer, [
      tok.hookInitializeInstruction(hook, payer.address, mint.address, extraMetas, policy, ix.TrustLevel.Attestor),
    ]);

  // mint_to хук не вызывает
  const ata = (owner: Address) => pda([bytesOf(owner), bytesOf(tok.TOKEN_2022), bytesOf(mint.address)], tok.ATA_PROGRAM);
  const [ataIssuer, ataA, ataB, ataC] = await Promise.all([payer, a, b, c].map((w) => ata(w.address)));
  const holders: [Address, Address][] = [
    [ataIssuer, payer.address],
    [ataA, a.address],
    [ataB, b.address],
    [ataC, c.address],
  ];
  await sendV0('token accounts + mint_to issuer', payer, [
    ...holders.map(([t, owner]) => tok.createAtaIdempotentInstruction(payer.address, t, owner, mint.address)),
    tok.mintToInstruction(mint.address, ataIssuer, payer.address, 100n),
  ]);

  // Хук пропускает только получателя с печатью
  const transfer = async (to: Address, owner: Address) =>
    tok.transferCheckedInstruction(ataIssuer, mint.address, to, payer.address, 1n, 0, [program, policy, await sealOf(owner), hook, extraMetas]);
  await sendV0('transfer → A (eIDAS seal)', payer, [await transfer(ataA, a.address)]);
  await sendV0('transfer → B (attestor seal)', payer, [await transfer(ataB, b.address)]);
  await sendRejected('transfer → C (no seal)', payer, [await transfer(ataC, c.address)], NOT_SEALED);

  await sendV0('revoke_seal (A)', a, [ix.revokeSealInstruction(program, { signer: a.address, address: a.address, programData: null, seal: sealAPda })]);
  await sendRejected('transfer → A after revoke', payer, [await transfer(ataA, a.address)], NOT_SEALED);

  await sealA('register_seal_p256 (A, eIDAS, re-seal)');
  console.log('A is sealed again (eIDAS), ready for the "who is behind this address" page:', sealAPda);

  console.log('seal B', sealB, ix.decodeSeal((await account(sealB))!));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
