import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionEncoder,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageConfig,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { compressP256, parseCertificate, signatureToLowS, subjectPolicyViolation } from './der.js';
import * as ix from './anchor.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const WS = process.env.WS_URL ?? 'wss://api.devnet.solana.com';
const EE_CERT = join(ROOT, 'fixtures/ee_large.der');

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const loadKeypair = (p: string) => createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(p, 'utf8'))));

async function main() {
  // TBS едет в транзакции целиком, и даже отклонённая программой транзакция остаётся в леджере.
  // Поэтому subject проверяется здесь, до любого RPC-запроса; NaturalPersonCert в программе — страховка.
  const ee = parseCertificate(new Uint8Array(readFileSync(EE_CERT)));
  const violation = subjectPolicyViolation(ee.subject);
  if (violation) {
    throw new Error(`refusing to send ${EE_CERT}: ${violation}. Only legal-person (seal) certificates are accepted.`);
  }

  const rpc = createSolanaRpc(RPC);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const payer = await loadKeypair(join(homedir(), '.config/solana/id.json'));
  const program = (await loadKeypair(join(ROOT, 'target/deploy/mor_registry-keypair.json'))).address;
  console.log('payer  ', payer.address);
  console.log('program', program);

  const enc = getAddressEncoder();
  const pda = async (seeds: (Uint8Array | string)[], programAddress: Address = program) =>
    (await getProgramDerivedAddress({ programAddress, seeds }))[0];
  const exists = async (a: Address) => (await rpc.getAccountInfo(a, { encoding: 'base64' }).send()).value !== null;

  const config = await pda(['config']);
  const programData = await pda([new Uint8Array(enc.encode(program))], ix.BPF_LOADER_UPGRADEABLE);

  // Транзакции v0 для админских шагов; v1 — только для регистрации.
  async function sendV0(label: string, instructions: Instruction[]) {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const tx = await signTransactionMessageWithSigners(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(payer, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      ),
    );
    // signTransactionMessageWithSigners types the lifetime as blockhash | durable-nonce; we only
    // ever build blockhash-lifetime messages here, so the runtime shape always satisfies
    // sendAndConfirmTransactionFactory's narrower (blockhash-only) parameter type.
    await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
    console.log(`${label}: ${getSignatureFromTransaction(tx)}`);
  }

  // 1. initialize
  if (await exists(config)) console.log('config already initialized');
  else await sendV0('initialize', [ix.initializeInstruction(program, payer.address, config, programData)]);

  // 2. add_trust_service для ca1
  const ca = parseCertificate(new Uint8Array(readFileSync(join(ROOT, 'fixtures/ca1.der'))));
  const caPubkey = compressP256(ca.publicKey);
  const spkiHash = sha256(ca.spki);
  const trustService = await pda(['trust', spkiHash]);
  if (await exists(trustService)) console.log('trust service already registered', trustService);
  else
    await sendV0('add_trust_service', [
      ix.addTrustServiceInstruction(program, payer.address, config, trustService, {
        pubkey: caPubkey,
        spkiHash,
        dnHash: sha256(ca.subject),
        name: 'Mor Test QTSP',
        country: 'EE',
      }),
    ]);

  // 3. register_certificate большого сертификата v1-транзакцией (subject проверен в начале main)
  const certificate = await pda(['cert', new Uint8Array(enc.encode(trustService)), ee.serial]);
  if (await exists(certificate)) {
    console.log('certificate already registered', certificate);
  } else {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) =>
        appendTransactionMessageInstructions(
          [
            ix.secp256r1Instruction(caPubkey, signatureToLowS(ee.signature), ee.tbs),
            ix.registerCertificateInstruction(program, payer.address, trustService, certificate, ee.serial),
          ],
          m,
        ),
      // В v1 лимиты живут в конфиге сообщения; незаданные равны нулю, а не значениям по умолчанию.
      (m) =>
        setTransactionMessageConfig(
          {
            computeUnitLimit: 400_000,
            loadedAccountsDataSizeLimit: 1024 * 1024,
            heapSize: 32 * 1024,
            priorityFeeLamports: 1_000n,
          },
          m,
        ),
    );
    const tx = await signTransactionMessageWithSigners(message);
    const size = getTransactionEncoder().encode(tx).length;
    console.log(`v1 transaction: ${size} bytes (TBS ${ee.tbs.length} bytes)`);
    if (size <= 1232) throw new Error('expected a transaction larger than the legacy limit');
    // Preflight-симуляция остаётся включённой: skipPreflight не передаём.
    await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
    const sig = getSignatureFromTransaction(tx);
    console.log(`register_certificate: ${sig}`);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }

  const acc = await rpc.getAccountInfo(certificate, { encoding: 'base64' }).send();
  const data = getBase64Encoder().encode(acc.value!.data[0]);
  console.log('certificate', certificate);
  console.log(ix.decodeCertificate(new Uint8Array(data)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
