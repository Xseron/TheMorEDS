import { AccountRole, address, getAddressEncoder, type Address, type Instruction } from '@solana/kit';
import { concat, discriminator, SYSTEM_PROGRAM, u32le } from './anchor.js';

export const TOKEN_2022 = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
/** Минт Token-2022 с одним расширением TransferHook: база 82 байта, добивка до 165, тип аккаунта (1),
 *  TLV-заголовок (4), данные расширения (authority 32 + program_id 32). */
export const MINT_WITH_HOOK_LEN = 234;

const bytes = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));

export function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

/** SystemInstruction::CreateAccount (0). Подпись нового аккаунта добавляет addSignersToInstruction. */
export function createAccountInstruction(payer: Address, account: Address, lamports: bigint, space: number, owner: Address): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: account, role: AccountRole.WRITABLE_SIGNER },
    ],
    data: concat(u32le(0), u64le(lamports), u64le(BigInt(space)), bytes(owner)),
  };
}

/** SystemInstruction::Transfer (2). */
export function transferSolInstruction(from: Address, to: Address, lamports: bigint): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from, role: AccountRole.WRITABLE_SIGNER },
      { address: to, role: AccountRole.WRITABLE },
    ],
    data: concat(u32le(2), u64le(lamports)),
  };
}

/** TransferHookExtension (36) / Initialize (0): authority и program_id — OptionalNonZeroPubkey. */
export function initializeTransferHookInstruction(mint: Address, authority: Address, hookProgram: Address): Instruction {
  return {
    programAddress: TOKEN_2022,
    accounts: [{ address: mint, role: AccountRole.WRITABLE }],
    data: concat(new Uint8Array([36, 0]), bytes(authority), bytes(hookProgram)),
  };
}

/** InitializeMint2 (20): decimals, mint_authority, freeze_authority = None. */
export function initializeMint2Instruction(mint: Address, decimals: number, mintAuthority: Address): Instruction {
  return {
    programAddress: TOKEN_2022,
    accounts: [{ address: mint, role: AccountRole.WRITABLE }],
    data: concat(new Uint8Array([20, decimals]), bytes(mintAuthority), new Uint8Array([0])),
  };
}

/** Associated Token Account: CreateIdempotent (1). */
export function createAtaIdempotentInstruction(payer: Address, ata: Address, owner: Address, mint: Address): Instruction {
  return {
    programAddress: ATA_PROGRAM,
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  };
}

/** MintTo (7): хук не вызывается — эмитент чеканит свободно. */
export function mintToInstruction(mint: Address, destination: Address, authority: Address, amount: bigint): Instruction {
  return {
    programAddress: TOKEN_2022,
    accounts: [
      { address: mint, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data: concat(new Uint8Array([7]), u64le(amount)),
  };
}

/** TransferChecked (12) и дополнительные аккаунты хука (только чтение; Token-2022 находит их по ключам). */
export function transferCheckedInstruction(
  source: Address,
  mint: Address,
  destination: Address,
  authority: Address,
  amount: bigint,
  decimals: number,
  extra: Address[],
): Instruction {
  return {
    programAddress: TOKEN_2022,
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: destination, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
      ...extra.map((a) => ({ address: a, role: AccountRole.READONLY })),
    ],
    data: concat(new Uint8Array([12]), u64le(amount), new Uint8Array([decimals])),
  };
}

/** sealed-transfer: initialize(min_trust_level) — подписывает mint authority. */
export function hookInitializeInstruction(
  hookProgram: Address,
  authority: Address,
  mint: Address,
  extraMetas: Address,
  policy: Address,
  minTrustLevel: number,
): Instruction {
  return {
    programAddress: hookProgram,
    accounts: [
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: mint, role: AccountRole.READONLY },
      { address: extraMetas, role: AccountRole.WRITABLE },
      { address: policy, role: AccountRole.WRITABLE },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
    ],
    data: concat(discriminator('initialize'), new Uint8Array([minTrustLevel])),
  };
}
