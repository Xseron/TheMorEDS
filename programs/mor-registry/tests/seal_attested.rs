mod common;

use {
    anchor_lang::prelude::Pubkey,
    common::*,
    mor_registry::{
        error::MorError,
        state::{Seal, TrustLevel},
    },
    solana_signer::Signer,
};

fn setup() -> (Env, Pubkey) {
    let mut env = Env::new();
    env.initialize().unwrap();
    let trust = env.add_attestor();
    (env, trust)
}

// 2. Кошелёк «ТОО «Ромашка»» запечатан через аттестатора; БИН — только хэшем с солью.
#[test]
fn seals_wallet_through_attestor() {
    let (mut env, trust) = setup();
    let romashka = env.fund_new();
    let r = SealReq::attested(&romashka.pubkey(), &trust);
    env.seal_attested(&r, &romashka)
        .unwrap_or_else(|e| panic!("{:?}\n{:#?}", e.err, e.meta.logs));

    let seal: Seal = env.account(&env.seal_pda(&romashka.pubkey()));
    assert_eq!(seal.trust_level, TrustLevel::Attestor);
    assert_eq!(seal.jurisdiction, *b"KZ");
    assert_eq!(seal.identifier_hash, r.identifier_hash);
    assert_eq!(seal.trust_service, trust);
    assert_eq!(seal.certificate, Pubkey::default());
    assert_eq!(seal.name, ROMASHKA);
}

// 11. Аттестатор подписал одно, в аргументах — другой хэш идентификатора или другое название.
#[test]
fn rejects_arguments_that_differ_from_attestation() {
    let (mut env, trust) = setup();
    let romashka = env.fund_new();
    let r = SealReq::attested(&romashka.pubkey(), &trust);
    let msg = env.attested_message(&r);

    let mut forged = r.clone();
    forged.identifier_hash[0] ^= 1;
    assert_mor_err(&env.seal_attested_signed(&forged, &romashka, &attestor(), &msg), MorError::SealMessageMismatch, 1);

    let mut forged = r.clone();
    forged.name = "ТОО «Лютик»".to_string();
    assert_mor_err(&env.seal_attested_signed(&forged, &romashka, &attestor(), &msg), MorError::SealMessageMismatch, 1);
}

// 12. УЦ P-256 на пути аттестатора.
#[test]
fn rejects_p256_trust_service_on_attested_path() {
    let (mut env, _trust) = setup();
    let ca_trust = env.add_trust_service(&ca1());
    let romashka = env.fund_new();
    let r = SealReq::attested(&romashka.pubkey(), &ca_trust);
    assert_mor_err(&env.seal_attested(&r, &romashka), MorError::UnsupportedTrustKind, 1);
}
