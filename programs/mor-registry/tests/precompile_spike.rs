mod common;

use {
    common::*,
    litesvm::LiteSVM,
    p256::ecdsa::{signature::Signer as _, Signature, SigningKey},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

fn svm_with_payer() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer)
}

fn sign(msg: &[u8]) -> ([u8; 33], [u8; 64]) {
    let sk = SigningKey::random(&mut rand_core::OsRng);
    let sig: Signature = sk.sign(msg);
    let sig = sig.normalize_s().unwrap_or(sig);
    let pk = sk.verifying_key().to_encoded_point(true);
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&sig.to_bytes());
    (pk.as_bytes().try_into().unwrap(), sig_bytes)
}

#[test]
fn precompile_accepts_low_s_big_endian_r_s() {
    let (mut svm, payer) = svm_with_payer();
    let msg = b"mor spike";
    let (pk, sig) = sign(msg);
    let res = send(&mut svm, &payer, &[], &[secp256r1_ix(&pk, &sig, msg)]);
    assert!(res.is_ok(), "precompile rejected r||s big-endian: {:?}", res.err().map(|e| e.err));
}

#[test]
fn precompile_rejects_high_s() {
    let (mut svm, payer) = svm_with_payer();
    let msg = b"mor spike";
    let (pk, sig) = sign(msg);
    let res = send(&mut svm, &payer, &[], &[secp256r1_ix(&pk, &high_s(&sig), msg)]);
    assert!(res.is_err(), "high-S signature must be rejected");
}

#[test]
fn precompile_rejects_tampered_message() {
    let (mut svm, payer) = svm_with_payer();
    let msg = b"mor spike";
    let (pk, sig) = sign(msg);
    let res = send(&mut svm, &payer, &[], &[secp256r1_ix(&pk, &sig, b"mor spikf")]);
    assert!(res.is_err(), "tampered message must be rejected");
}

#[test]
fn litesvm_accepts_transaction_over_1232_bytes() {
    let (mut svm, payer) = svm_with_payer();
    let msg = vec![0xA5u8; 2000];
    let (pk, sig) = sign(&msg);
    let res = send(&mut svm, &payer, &[], &[secp256r1_ix(&pk, &sig, &msg)]);
    assert!(res.is_ok(), "LiteSVM enforces packet size: {:?}", res.err().map(|e| e.err));
}
