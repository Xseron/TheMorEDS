import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  addSignersToInstruction,
  address,
  appendTransactionMessageInstructions,
  createKeyPairFromBytes,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageConfig,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { compressP256, parseCertificate, signatureToLowS } from './der.js';
import * as ix from './anchor.js';
import * as tok from './token.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const WS = process.env.WS_URL ?? 'wss://api.devnet.solana.com';
const PROGRAM_ID = process.env.PROGRAM_ID ?? 'CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP';
// Адрес хука — из Anchor.toml, чтобы не дублировать его в коде.
const HOOK_ID =
  process.env.HOOK_ID ?? readFileSync(join(ROOT, 'Anchor.toml'), 'utf8').match(/sealed_transfer = "(\w+)"/)![1];
const DEMO = join(homedir(), '.config/solana/mor-demo');
const BIN = '123456789012'; // тестовый БИН демо-организации
const ROMASHKA = 'ТОО «Ромашка»';
const DAY = 86_400n;
const NOT_SEALED = 9100; // mor-verify-seal: SealError::NotSealed

const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash('sha256');
  parts.forEach((p) => h.update(p));
  return new Uint8Array(h.digest());
};
const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const loadKeypair = (p: string) => createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(p, 'utf8'))));

/** Демо-ключ: создаётся при первом запуске и переиспользуется (формат keypair Solana, 64 байта). */
async function demoKey(name: string): Promise<KeyPairSigner> {
  const path = join(DEMO, `${name}.json`);
  if (!existsSync(path)) {
    mkdirSync(DEMO, { recursive: true });
    const seed = new Uint8Array(randomBytes(32));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    writeFileSync(path, JSON.stringify([...seed, ...getAddressEncoder().encode(signer.address)]), { mode: 0o600 });
  }
  return loadKeypair(path);
}

/** Custom-код ошибки в цепочке ошибок kit или в логах preflight-симуляции. */
function hasCustomError(e: unknown, code: number): boolean {
  const needle = `custom program error: 0x${code.toString(16)}`;
  for (let cur: any = e; cur; cur = cur.cause) {
    if (cur?.context?.code === code) return true;
    const logs: unknown = cur?.context?.logs;
    if (Array.isArray(logs) && logs.some((l) => String(l).includes(needle))) return true;
  }
  return false;
}

async function main() {
  const rpc = createSolanaRpc(RPC);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const payer = await loadKeypair(join(homedir(), '.config/solana/id.json')); // админ реестра и эмитент токена
  const program = address(PROGRAM_ID);
  const hook = address(HOOK_ID);
  const enc = getAddressEncoder();
  const bytesOf = (a: Address) => new Uint8Array(enc.encode(a));
  const pda = async (seeds: (Uint8Array | string)[], programAddress: Address = program) =>
    (await getProgramDerivedAddress({ programAddress, seeds }))[0];
  const account = async (a: Address) => {
    const v = (await rpc.getAccountInfo(a, { encoding: 'base64' }).send()).value;
    return v ? new Uint8Array(getBase64Encoder().encode(v.data[0])) : null;
  };
  const sealOf = (owner: Address) => pda(['seal', bytesOf(owner)]);
  const report = (label: string, sig: string) => console.log(`${label}: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  // signTransactionMessageWithSigners types the lifetime as blockhash | durable-nonce; we only build
  // blockhash-lifetime messages, so the cast to sendAndConfirm's parameter type is safe (as in main.ts).
  async function sendV0(label: string, feePayer: KeyPairSigner, instructions: Instruction[]) {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const tx = await signTransactionMessageWithSigners(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      ),
    );
    await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
    report(label, getSignatureFromTransaction(tx));
  }

  /** Регистрация печати — v1-транзакция; в v1 незаданные лимиты равны нулю, поэтому они явные. */
  async function sendV1(label: string, feePayer: KeyPairSigner, instructions: Instruction[]) {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const tx = await signTransactionMessageWithSigners(
      pipe(
        createTransactionMessage({ version: 1 }),
        (m) => setTransactionMessageFeePayerSigner(feePayer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
        (m) =>
          setTransactionMessageConfig(
            { computeUnitLimit: 400_000, loadedAccountsDataSizeLimit: 1024 * 1024, heapSize: 32 * 1024, priorityFeeLamports: 1_000n },
            m,
          ),
      ),
    );
    await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
    report(label, getSignatureFromTransaction(tx));
  }

  /** Транзакция, которую хук обязан отклонить: preflight-симуляция падает с кодом `code`. */
  async function sendRejected(label: string, feePayer: KeyPairSigner, instructions: Instruction[], code: number) {
    try {
      await sendV0(label, feePayer, instructions);
    } catch (e) {
      if (hasCustomError(e, code)) {
        console.log(`${label}: rejected as expected (custom error ${code})`);
        return;
      }
      throw e;
    }
    throw new Error(`${label}: expected custom error ${code}, but the transaction landed`);
  }

  console.log('payer   ', payer.address);
  console.log('registry', program);
  console.log('hook    ', hook);

  // 0. Сертификат Acme из скрипта недели 1 (npm run devnet) — основа eIDAS-печати.
  const ca = parseCertificate(new Uint8Array(readFileSync(join(ROOT, 'fixtures/ca1.der'))));
  const caTrust = await pda(['trust', sha256(ca.spki)]);
  const ee = parseCertificate(new Uint8Array(readFileSync(join(ROOT, 'fixtures/ee_large.der'))));
  const certificate = await pda(['cert', bytesOf(caTrust), ee.serial]);
  const certData = await account(certificate);
  if (!certData) throw new Error(`certificate ${certificate} is not registered: run \`npm run devnet\` first`);
  const cert = ix.decodeCertificate(certData);

  // 1. Тестовый аттестатор КЗ (Ed25519, fixtures/keys/attestor.json — только для тестов и демо).
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

  // 2. Демо-кошельки: A — Acme (eIDAS), B — Ромашка (аттестатор), C — без печати.
  const [a, b, c, mint] = await Promise.all(['a', 'b', 'c', 'mint'].map(demoKey));
  for (const w of [a, b]) {
    const { value } = await rpc.getBalance(w.address).send();
    if (value < 20_000_000n) await sendV0(`fund ${w.address}`, payer, [tok.transferSolInstruction(payer.address, w.address, 50_000_000n)]);
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = now + 600n;

  // 3. Печать A через eIDAS: ключ сертификата Acme подписывает сообщение, A — транзакцию.
  const sealA = await sealOf(a.address);
  if (await account(sealA)) console.log('A already sealed', sealA);
  else {
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
    await sendV1('register_seal_p256 (A, eIDAS)', a, [
      ix.secp256r1Instruction(compressP256(ee.publicKey), signatureToLowS(new Uint8Array(der)), msg),
      ix.registerSealP256Instruction(program, {
        controller: a.address,
        address: a.address,
        programData: null,
        trustService: caTrust,
        certificate,
        seal: sealA,
        kind: ix.AddressKind.Wallet,
        salt,
        expiresAt,
        signDeadline: deadline,
      }),
    ]);
  }

  // 4. Печать B через аттестатора: на цепочку попадает только sha256(соль ‖ KZ ‖ БИН).
  const sealB = await sealOf(b.address);
  if (await account(sealB)) console.log('B already sealed', sealB);
  else {
    const salt = new Uint8Array(randomBytes(32));
    const identifierHash = sha256(salt, utf8('KZ'), utf8(BIN));
    console.log(`B: BIN salt ${hex(salt)} (the owner keeps it to disclose the BIN off-chain)`);
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

  // 5. Токен с хуком: переводы только владельцам с печатью уровня Attestor и выше.
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

  // 6. Токен-аккаунты и эмиссия эмитенту (mint_to хук не вызывает).
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

  // 7. Переводы: хук пропускает только получателя с печатью.
  const transfer = async (to: Address, owner: Address) =>
    tok.transferCheckedInstruction(ataIssuer, mint.address, to, payer.address, 1n, 0, [program, policy, await sealOf(owner), hook, extraMetas]);
  await sendV0('transfer → A (eIDAS seal)', payer, [await transfer(ataA, a.address)]);
  await sendV0('transfer → B (attestor seal)', payer, [await transfer(ataB, b.address)]);
  await sendRejected('transfer → C (no seal)', payer, [await transfer(ataC, c.address)], NOT_SEALED);

  // 8. Отзыв печати A её контролёром — перевод A снова отклоняется. Следующий запуск запечатает A заново.
  await sendV0('revoke_seal (A)', a, [ix.revokeSealInstruction(program, { signer: a.address, address: a.address, programData: null, seal: sealA })]);
  await sendRejected('transfer → A after revoke', payer, [await transfer(ataA, a.address)], NOT_SEALED);

  console.log('seal B', sealB, ix.decodeSeal((await account(sealB))!));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
