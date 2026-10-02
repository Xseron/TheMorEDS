// Общее для сценариев devnet: RPC, отправка v0/v1-транзакций, PDA, демо-ключи.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  address,
  appendTransactionMessageInstructions,
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
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';

export const ROOT = join(import.meta.dirname, '..', '..', '..');
export const DEMO = join(homedir(), '.config/solana/mor-demo');
const RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const WS = process.env.WS_URL ?? 'wss://api.devnet.solana.com';
export const PROGRAM_ID = process.env.PROGRAM_ID ?? 'CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP';
// Адрес хука — из Anchor.toml, чтобы не дублировать его в коде.
export const HOOK_ID =
  process.env.HOOK_ID ?? readFileSync(join(ROOT, 'Anchor.toml'), 'utf8').match(/sealed_transfer = "(\w+)"/)![1];

export const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash('sha256');
  parts.forEach((p) => h.update(p));
  return new Uint8Array(h.digest());
};
export const utf8 = (s: string) => new TextEncoder().encode(s);
export const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
export const loadKeypair = (p: string) => createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(p, 'utf8'))));

/** Демо-ключ: создаётся при первом запуске и переиспользуется (формат keypair Solana, 64 байта). */
export async function demoKey(name: string): Promise<KeyPairSigner> {
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
export function hasCustomError(e: unknown, code: number): boolean {
  const needle = `custom program error: 0x${code.toString(16)}`;
  for (let cur: any = e; cur; cur = cur.cause) {
    if (cur?.context?.code === code) return true;
    const logs: unknown = cur?.context?.logs;
    if (Array.isArray(logs) && logs.some((l) => String(l).includes(needle))) return true;
  }
  return false;
}

/** Подключение к devnet: плательщик (админ реестра и эмитент токена) и помощники отправки. */
export async function connect() {
  const rpc = createSolanaRpc(RPC);
  const rpcSubscriptions = createSolanaRpcSubscriptions(WS);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const payer = await loadKeypair(join(homedir(), '.config/solana/id.json'));
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

  return { rpc, payer, program, hook, bytesOf, pda, account, sealOf, sendV0, sendV1, sendRejected };
}
