mod common;

use {
    anchor_lang::{prelude::Pubkey, solana_program::system_instruction},
    common::*,
    mor_registry::{
        error::MorError,
        state::{AddressKind, Seal, SubjectType, TrustLevel},
    },
    solana_signer::Signer,
};

fn setup() -> (Env, Pubkey, Pubkey) {
    let mut env = Env::new();
    env.initialize().unwrap();
    let (trust, cert) = env.eidas();
    (env, trust, cert)
}

fn ok(res: TxResult) {
    res.unwrap_or_else(|e| panic!("{:?}\n{:#?}", e.err, e.meta.logs));
}

// 1. Кошелёк Acme запечатан своим сертификатом; повторная печать того же адреса невозможна.
#[test]
fn seals_wallet_with_eidas_certificate() {
    let (mut env, trust, cert) = setup();
    let acme = env.fund_new();
    let r = SealReq::wallet(&acme.pubkey(), &trust, &cert);
    ok(env.seal_p256(&r, &acme));

    let seal: Seal = env.account(&env.seal_pda(&acme.pubkey()));
    assert_eq!(seal.address, acme.pubkey());
    assert_eq!(seal.address_kind, AddressKind::Wallet);
    assert_eq!(seal.controller, acme.pubkey());
    assert_eq!(seal.trust_level, TrustLevel::Trustless);
    assert_eq!(seal.jurisdiction, *b"EE");
    assert_eq!(seal.subject_type, SubjectType::LegalEntity);
    assert_eq!(seal.identifier_hash, sha256(&[&SALT[..], b"EE", b"NTREE-12345678"].concat()));
    assert_eq!(seal.trust_service, trust);
    assert_eq!(seal.certificate, cert);
    assert_eq!(seal.expires_at, r.expires_at);
    assert_eq!(seal.created_at, now());
    assert_eq!(seal.name, "Acme Robotics");

    assert!(env.seal_p256(&r, &acme).is_err(), "address is already sealed");
    let still: Seal = env.account(&env.seal_pda(&acme.pubkey()));
    assert_eq!(still.expires_at, seal.expires_at);
}

// 3. Программу печатает её upgrade authority (без ProgramData — отказ), минт — mint authority.
#[test]
fn seals_program_and_mint_by_their_authorities() {
    let (mut env, trust, cert) = setup();
    let admin = env.admin.insecure_clone();
    let program_id = env.program_id;
    let mut r = SealReq::wallet(&admin.pubkey(), &trust, &cert);
    r.kind = AddressKind::Program;
    r.address = program_id;
    assert_mor_err(&env.seal_p256(&r, &admin), MorError::NotController, 1);
    r.program_data = Some(program_data_pda(&program_id));
    ok(env.seal_p256(&r, &admin));
    assert_eq!(env.account::<Seal>(&env.seal_pda(&program_id)).address_kind, AddressKind::Program);

    let authority = env.fund_new();
    let mint = Pubkey::new_unique();
    set_mint(&mut env.svm, &mint, &authority.pubkey());
    let mut r = SealReq::wallet(&authority.pubkey(), &trust, &cert);
    r.kind = AddressKind::Mint;
    r.address = mint;
    ok(env.seal_p256(&r, &authority));
    assert_eq!(env.account::<Seal>(&env.seal_pda(&mint)).controller, authority.pubkey());
}

// 5. Подпись над одним сообщением, аргументы — другие.
#[test]
fn rejects_message_that_differs_from_arguments() {
    let (mut env, trust, cert) = setup();
    let acme = env.fund_new();
    let r = SealReq::wallet(&acme.pubkey(), &trust, &cert);
    let mut signed = r.clone();
    signed.expires_at += 1;
    let msg = env.p256_message(&signed);
    assert_mor_err(&env.seal_p256_signed(&r, &acme, EE_KEY_PEM, &msg), MorError::SealMessageMismatch, 1);
}

// 6. Прекомпайл проверил подпись ключом УЦ, а не ключом сертификата организации.
#[test]
fn rejects_signature_by_another_key() {
    let (mut env, trust, cert) = setup();
    let acme = env.fund_new();
    let r = SealReq::wallet(&acme.pubkey(), &trust, &cert);
    let msg = env.p256_message(&r);
    assert_mor_err(&env.seal_p256_signed(&r, &acme, CA1_KEY_PEM, &msg), MorError::UntrustedKey, 1);
}

// 7. Между прекомпайлом и печатью — другая инструкция.
#[test]
fn rejects_precompile_not_immediately_before() {
    let (mut env, trust, cert) = setup();
    let acme = env.fund_new();
    let r = SealReq::wallet(&acme.pubkey(), &trust, &cert);
    let msg = env.p256_message(&r);
    let ixs = [
        secp256r1_ix(&p256_pubkey(EE_KEY_PEM), &sign_p256(EE_KEY_PEM, &msg), &msg),
        system_instruction::transfer(&acme.pubkey(), &env.payer.pubkey(), 1),
        env.seal_p256_ix(&r),
    ];
    assert_mor_err(&env.send(&acme, &[], &ixs), MorError::PrecompileMissing, 2);
}

// 8. Ed25519-проверка того же сообщения вместо secp256r1.
#[test]
fn rejects_ed25519_precompile_on_eidas_path() {
    let (mut env, trust, cert) = setup();
    let acme = env.fund_new();
    let r = SealReq::wallet(&acme.pubkey(), &trust, &cert);
    let msg = env.p256_message(&r);
    let sig = acme.sign_message(&msg);
    let ixs = [ed25519_ix(&acme.pubkey().to_bytes(), sig.as_ref().try_into().unwrap(), &msg), env.seal_p256_ix(&r)];
    assert_mor_err(&env.send(&acme, &[], &ixs), MorError::PrecompileMissing, 1);
}

// 9. Посторонний выдаёт себя за mint authority.
#[test]
fn rejects_stranger_posing_as_mint_authority() {
    let (mut env, trust, cert) = setup();
    let mint = Pubkey::new_unique();
    set_mint(&mut env.svm, &mint, &Pubkey::new_unique());
    let stranger = env.fund_new();
    let mut r = SealReq::wallet(&stranger.pubkey(), &trust, &cert);
    r.kind = AddressKind::Mint;
    r.address = mint;
    assert_mor_err(&env.seal_p256(&r, &stranger), MorError::NotController, 1);
}

// 10. Подпись опоздала; срок печати позже конца сертификата.
#[test]
fn rejects_late_signature_and_expiry_beyond_certificate() {
    let (mut env, trust, cert) = setup();
    let acme = env.fund_new();
    let mut r = SealReq::wallet(&acme.pubkey(), &trust, &cert);
    r.sign_deadline = now() - 1;
    assert_mor_err(&env.seal_p256(&r, &acme), MorError::SignDeadlinePassed, 1);

    let mut r = SealReq::wallet(&acme.pubkey(), &trust, &cert);
    r.expires_at = validity(EE_SMALL).1 + 1;
    assert_mor_err(&env.seal_p256(&r, &acme), MorError::InvalidExpiry, 1);
}

// 4. Посторонний не отзывает; после смены mint authority новый владелец снимает печать,
// выданную при прежнем, и запечатывает минт заново.
#[test]
fn stranger_cannot_revoke_new_mint_authority_can() {
    let (mut env, trust, cert) = setup();
    let old = env.fund_new();
    let mint = Pubkey::new_unique();
    set_mint(&mut env.svm, &mint, &old.pubkey());
    let mut r = SealReq::wallet(&old.pubkey(), &trust, &cert);
    r.kind = AddressKind::Mint;
    r.address = mint;
    ok(env.seal_p256(&r, &old));

    let stranger = env.fund_new();
    assert_mor_err(&env.revoke(&stranger, &mint, None), MorError::NotController, 0);

    let new = env.fund_new();
    set_mint(&mut env.svm, &mint, &new.pubkey());
    ok(env.revoke(&new, &mint, None));
    let pda = env.seal_pda(&mint);
    assert!(env.svm.get_account(&pda).map_or(true, |a| a.data.is_empty()), "seal must be closed");

    r.controller = new.pubkey();
    ok(env.seal_p256(&r, &new));
    assert_eq!(env.account::<Seal>(&pda).controller, new.pubkey());
}
