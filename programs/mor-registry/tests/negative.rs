mod common;

use {
    anchor_lang::solana_program::system_instruction,
    common::*,
    mor_registry::error::MorError,
    solana_signer::Signer,
};

fn env_with_ca1() -> (Env, common::CaFixture, anchor_lang::prelude::Pubkey) {
    let mut env = Env::new();
    env.initialize().unwrap();
    let ca = ca1();
    let trust = env.add_trust_service(&ca);
    (env, ca, trust)
}

// Ключ подписавшего УЦ передан честно, но сам УЦ не зарегистрирован
#[test]
fn rejects_certificate_from_untrusted_ca() {
    let (mut env, _ca, trust) = env_with_ca1();
    let res = env.register(&trust, &ca2().pubkey, &ee(EE_OTHER_CA));
    assert_mor_err(&res, MorError::UntrustedKey, 1);
}

// Ключ ca1, но issuer другой: ротация DN с тем же ключом не зарегистрирована
#[test]
fn rejects_issuer_mismatch() {
    let (mut env, ca, trust) = env_with_ca1();
    let res = env.register(&trust, &ca.pubkey, &ee(EE_WRONG_ISSUER));
    assert_mor_err(&res, MorError::IssuerMismatch, 1);
}

#[test]
fn rejects_natural_person_certificate() {
    let (mut env, ca, trust) = env_with_ca1();
    let res = env.register(&trust, &ca.pubkey, &ee(EE_PERSON));
    assert_mor_err(&res, MorError::NaturalPersonCert, 1);
}

// Индекс 0 вместо 0xFFFF прекомпайл принимает, программа нет
#[test]
fn rejects_precompile_with_absolute_self_index() {
    let (mut env, ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    let mut payload = Vec::new();
    payload.extend_from_slice(&ca.pubkey);
    payload.extend_from_slice(&cert.sig);
    payload.extend_from_slice(cert.tbs);
    let pre = secp256r1_ix_raw(1, [49, 0xFFFF, 16, 0xFFFF, 113, cert.tbs.len() as u16, 0], &payload);
    let payer = env.payer.insecure_clone();
    let reg = env.register_ix(&trust, &payer.pubkey(), &cert.serial);
    let res = env.send(&payer, &[], &[pre, reg]);
    assert_mor_err(&res, MorError::PrecompileMalformed, 1);
}

#[test]
fn rejects_precompile_with_two_signatures() {
    let (mut env, ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    // данные начинаются после 2 + 2 x 14 = 30 байт
    let offsets = [63u16, 0xFFFF, 30, 0xFFFF, 127, cert.tbs.len() as u16, 0xFFFF];
    let mut data = vec![2u8, 0];
    for _ in 0..2 {
        for v in offsets {
            data.extend_from_slice(&v.to_le_bytes());
        }
    }
    data.extend_from_slice(&ca.pubkey);
    data.extend_from_slice(&cert.sig);
    data.extend_from_slice(cert.tbs);
    let pre = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(SECP256R1_PROGRAM_ID, &data, vec![]);
    let payer = env.payer.insecure_clone();
    let reg = env.register_ix(&trust, &payer.pubkey(), &cert.serial);
    let res = env.send(&payer, &[], &[pre, reg]);
    assert_mor_err(&res, MorError::PrecompileMalformed, 1);
}

#[test]
fn rejects_missing_precompile_when_first() {
    let (mut env, _ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    let payer = env.payer.insecure_clone();
    let reg = env.register_ix(&trust, &payer.pubkey(), &cert.serial);
    let res = env.send(&payer, &[], &[reg]);
    assert_mor_err(&res, MorError::PrecompileMissing, 0);
}

#[test]
fn rejects_missing_precompile_when_other_instruction_before() {
    let (mut env, _ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    let payer = env.payer.insecure_clone();
    let transfer = system_instruction::transfer(&payer.pubkey(), &env.admin.pubkey(), 1);
    let reg = env.register_ix(&trust, &payer.pubkey(), &cert.serial);
    let res = env.send(&payer, &[], &[transfer, reg]);
    assert_mor_err(&res, MorError::PrecompileMissing, 1);
}

#[test]
fn rejects_serial_mismatch() {
    let (mut env, ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    let payer = env.payer.insecure_clone();
    let mut other = cert.serial.clone();
    other[0] ^= 0x01;
    let ixs = [secp256r1_ix(&ca.pubkey, &cert.sig, cert.tbs), env.register_ix(&trust, &payer.pubkey(), &other)];
    let res = env.send(&payer, &[], &ixs);
    assert_mor_err(&res, MorError::SerialMismatch, 1);
}

#[test]
fn rejects_expired_and_not_yet_valid() {
    let (mut env, ca, trust) = env_with_ca1();
    let (not_before, not_after) = validity(EE_SMALL);
    env.set_clock(not_after + 1);
    let res = env.register(&trust, &ca.pubkey, &ee(EE_SMALL));
    assert_mor_err(&res, MorError::CertExpired, 1);
    env.set_clock(not_before - 1);
    let res = env.register(&trust, &ca.pubkey, &ee(EE_SMALL));
    assert_mor_err(&res, MorError::CertNotYetValid, 1);
}

#[test]
fn rejects_rsa_key_and_missing_org_id() {
    let (mut env, ca, trust) = env_with_ca1();
    let res = env.register(&trust, &ca.pubkey, &ee(EE_RSA));
    assert_mor_err(&res, MorError::UnsupportedKey, 1);
    let res = env.register(&trust, &ca.pubkey, &ee(EE_NO_ORGID));
    assert_mor_err(&res, MorError::MissingOrgAttributes, 1);
}

#[test]
fn precompile_rejects_tampered_tbs_and_high_s() {
    let (mut env, ca, trust) = env_with_ca1();
    let cert = ee(EE_SMALL);
    let payer = env.payer.insecure_clone();

    let mut tampered = cert.tbs.to_vec();
    tampered[cert.tbs.len() / 2] ^= 0x01;
    let ixs = [secp256r1_ix(&ca.pubkey, &cert.sig, &tampered), env.register_ix(&trust, &payer.pubkey(), &cert.serial)];
    let err = env.send(&payer, &[], &ixs).expect_err("tampered TBS must fail");
    assert_eq!(failed_ix(&err).map(|(ix, _)| ix), Some(0), "must fail in the precompile: {:?}", err.err);

    let ixs = [secp256r1_ix(&ca.pubkey, &high_s(&cert.sig), cert.tbs), env.register_ix(&trust, &payer.pubkey(), &cert.serial)];
    let err = env.send(&payer, &[], &ixs).expect_err("high-S must fail");
    assert_eq!(failed_ix(&err).map(|(ix, _)| ix), Some(0), "must fail in the precompile: {:?}", err.err);
}

// Самоподписанный ca1 проходит все проверки, кроме CA:TRUE
#[test]
fn rejects_ca_certificate_as_end_entity() {
    let (mut env, ca, trust) = env_with_ca1();
    let res = env.register(&trust, &ca.pubkey, &ee(CA1));
    assert_mor_err(&res, MorError::NotEndEntity, 1);
}

// OCSP-респондер подписывает чужие данные, печатью он быть не может
#[test]
fn rejects_ocsp_signing_certificate() {
    let (mut env, ca, trust) = env_with_ca1();
    let res = env.register(&trust, &ca.pubkey, &ee(EE_OCSP));
    assert_mor_err(&res, MorError::ForbiddenKeyPurpose, 1);
}
