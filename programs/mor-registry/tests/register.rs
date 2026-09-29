mod common;

use {
    common::*,
    mor_registry::state::Certificate,
    solana_signer::Signer,
    solana_transaction_error::TransactionError,
};

fn env_with_ca1() -> (Env, solana_keypair::Keypair, common::CaFixture, anchor_lang::prelude::Pubkey) {
    let mut env = Env::new();
    env.initialize().unwrap();
    let ca = ca1();
    let trust = env.add_trust_service(&ca);
    let payer = env.payer.insecure_clone();
    (env, payer, ca, trust)
}

#[test]
fn registers_small_certificate() {
    let (mut env, _payer, ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    env.register(&trust, &ca.pubkey, &cert)
        .unwrap_or_else(|e| panic!("{:?}\n{:#?}", e.err, e.meta.logs));

    let acc: Certificate = env.account(&env.cert_pda(&trust, &cert.serial));
    assert_eq!(acc.trust_service, trust);
    assert_eq!(acc.serial, cert.serial);
    assert_eq!(acc.tbs_hash, sha256(cert.tbs));
    assert_eq!(acc.subject_key, cert.subject_key);
    assert_eq!(acc.org_name, "Acme Robotics");
    assert_eq!(acc.org_id, "NTREE-12345678");
    assert_eq!(acc.country, *b"EE");
    assert!(acc.not_before <= NOW && NOW <= acc.not_after);
    assert_eq!(acc.registered_at, NOW);
}

#[test]
fn registers_large_certificate_over_legacy_limit() {
    let (mut env, payer, ca, trust) = env_with_ca1();
    let cert = ee(EE_LARGE);
    let ixs = [
        secp256r1_ix(&ca.pubkey, &cert.sig, cert.tbs),
        env.register_ix(&trust, &payer.pubkey(), &cert.serial),
    ];
    let size = tx_size(&env, &payer, &ixs);
    assert!(size > 1232, "large fixture must not fit a legacy transaction, got {size} bytes");
    env.send(&payer, &[], &ixs).unwrap_or_else(|e| panic!("{:?}\n{:#?}", e.err, e.meta.logs));

    let acc: Certificate = env.account(&env.cert_pda(&trust, &cert.serial));
    assert_eq!(acc.org_name, "Acme Robotics OÜ");
    assert_eq!(acc.tbs_hash, sha256(cert.tbs));
}

#[test]
fn same_certificate_cannot_be_registered_twice() {
    let (mut env, _payer, ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    env.register(&trust, &ca.pubkey, &cert).unwrap();
    let res = env.register(&trust, &ca.pubkey, &cert);
    match res {
        Err(e) => assert!(
            matches!(e.err, TransactionError::InstructionError(1, _)),
            "expected InstructionError(1, _), got {:?}",
            e.err
        ),
        Ok(_) => panic!("expected second register to fail"),
    }
}

#[test]
fn anyone_can_register_a_valid_certificate() {
    let (mut env, _payer, ca, trust) = env_with_ca1();
    let stranger = env.fund_new();
    let cert = ee(EE_SMALL);
    let ixs = [
        secp256r1_ix(&ca.pubkey, &cert.sig, cert.tbs),
        env.register_ix(&trust, &stranger.pubkey(), &cert.serial),
    ];
    env.send(&stranger, &[], &ixs).unwrap_or_else(|e| panic!("{:?}\n{:#?}", e.err, e.meta.logs));
}
