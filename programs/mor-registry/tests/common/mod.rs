#![allow(dead_code)]

use {
    anchor_lang::{prelude::Pubkey, pubkey, solana_program::instruction::Instruction},
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    p256::{
        elliptic_curve::{ops::Reduce, PrimeField},
        Scalar, U256,
    },
    solana_instruction::error::InstructionError,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
};

pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");

/// Layout SIMD-0075: [num_signatures u8][padding u8][7 x u16 LE][data].
pub fn secp256r1_ix_raw(num_sigs: u8, offsets: [u16; 7], payload: &[u8]) -> Instruction {
    let mut data = Vec::with_capacity(16 + payload.len());
    data.push(num_sigs);
    data.push(0);
    for v in offsets {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(payload);
    Instruction::new_with_bytes(SECP256R1_PROGRAM_ID, &data, vec![])
}

/// Self-contained instruction: pubkey, signature and message all live in it,
/// every instruction_index == 0xFFFF. Data starts at offset 16.
pub fn secp256r1_ix(pubkey: &[u8; 33], sig: &[u8; 64], msg: &[u8]) -> Instruction {
    let pk_off: u16 = 16;
    let sig_off: u16 = pk_off + 33;
    let msg_off: u16 = sig_off + 64;
    let mut payload = Vec::with_capacity(33 + 64 + msg.len());
    payload.extend_from_slice(pubkey);
    payload.extend_from_slice(sig);
    payload.extend_from_slice(msg);
    secp256r1_ix_raw(
        1,
        [sig_off, 0xFFFF, pk_off, 0xFFFF, msg_off, msg.len() as u16, 0xFFFF],
        &payload,
    )
}

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    // Ruling R2: force a fresh blockhash so every transaction is unique,
    // otherwise LiteSVM rejects a byte-identical repeat with AlreadyProcessed
    // before the program/precompile ever runs.
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend_from_slice(signers);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
    svm.send_transaction(tx)
}

/// (failed instruction index, Custom code) — for Anchor errors code = 6000 + variant number.
pub fn failed_ix(err: &FailedTransactionMetadata) -> Option<(u8, u32)> {
    match &err.err {
        TransactionError::InstructionError(ix, InstructionError::Custom(code)) => Some((*ix, *code)),
        _ => None,
    }
}

/// s -> n - s: the signature stays mathematically valid but becomes high-S.
pub fn high_s(sig: &[u8; 64]) -> [u8; 64] {
    let s = Scalar::reduce(U256::from_be_slice(&sig[32..]));
    let neg = -s;
    let mut out = *sig;
    out[32..].copy_from_slice(&neg.to_repr());
    out
}
