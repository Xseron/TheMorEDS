mod common;

use {
    common::*,
    mor_registry::{
        error::MorError,
        state::{Config, TrustKind, TrustService},
    },
    solana_signer::Signer,
    solana_transaction_error::TransactionError,
};

#[test]
fn initialize_sets_admin() {
    let mut env = Env::new();
    env.initialize().unwrap_or_else(|e| panic!("{:?}\n{:#?}", e.err, e.meta.logs));
    let cfg: Config = env.account(&env.config_pda());
    assert_eq!(cfg.admin, env.admin.pubkey());
}

#[test]
fn initialize_rejects_non_upgrade_authority() {
    let mut env = Env::new();
    let stranger = env.fund_new();
    let res = env.initialize_as(&stranger);
    assert_mor_err(&res, MorError::Unauthorized, 0);
}

#[test]
fn initialize_twice_fails_and_keeps_admin() {
    let mut env = Env::new();
    env.initialize().unwrap();
    // Даже upgrade authority не может пересоздать Config: аккаунт уже существует.
    let res = env.initialize();
    match res {
        Err(e) => assert!(
            matches!(e.err, TransactionError::InstructionError(0, _)),
            "expected InstructionError(0, _), got {:?}",
            e.err
        ),
        Ok(_) => panic!("expected second initialize to fail"),
    }
    let cfg: Config = env.account(&env.config_pda());
    assert_eq!(cfg.admin, env.admin.pubkey());
}

#[test]
fn add_trust_service_stores_fields() {
    let mut env = Env::new();
    env.initialize().unwrap();
    let ca = ca1();
    let trust = env.add_trust_service(&ca);
    let ts: TrustService = env.account(&trust);
    assert_eq!(ts.kind, TrustKind::P256Ca);
    assert_eq!(ts.pubkey, ca.pubkey);
    assert_eq!(ts.spki_hash, ca.spki_hash);
    assert_eq!(ts.subject_dn_hash, ca.dn_hash);
    assert_eq!(ts.name, "Mor Test QTSP");
    assert_eq!(ts.country, *b"EE");
}

#[test]
fn add_trust_service_rejects_non_admin() {
    let mut env = Env::new();
    env.initialize().unwrap();
    let stranger = env.fund_new();
    let res = env.add_trust_service_as(&stranger, TrustKind::P256Ca, &ca1());
    assert_mor_err(&res, MorError::Unauthorized, 0);
}

#[test]
fn add_trust_service_rejects_malformed_attestor() {
    let mut env = Env::new();
    env.initialize().unwrap();
    let admin = env.admin.insecure_clone();
    let res = env.add_trust_service_as(&admin, TrustKind::Attestor, &ca1());
    assert_mor_err(&res, MorError::BadAttestorKey, 0);
}

#[test]
fn add_trust_service_twice_fails() {
    let mut env = Env::new();
    env.initialize().unwrap();
    env.add_trust_service(&ca1());
    let admin = env.admin.insecure_clone();
    let res = env.add_trust_service_as(&admin, TrustKind::P256Ca, &ca1());
    match res {
        Err(e) => assert!(
            matches!(e.err, TransactionError::InstructionError(0, _)),
            "expected InstructionError(0, _), got {:?}",
            e.err
        ),
        Ok(_) => panic!("expected second add_trust_service to fail"),
    }
}
