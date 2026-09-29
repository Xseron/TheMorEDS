use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sha256_hasher::hash;

use crate::{
    constants::*,
    error::MorError,
    secp256r1,
    state::{Certificate, TrustKind, TrustService},
    x509::{self, X509Error},
};

#[derive(Accounts)]
#[instruction(serial: Vec<u8>)]
pub struct RegisterCertificate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub trust_service: Account<'info, TrustService>,
    #[account(
        init,
        payer = payer,
        space = 8 + Certificate::INIT_SPACE,
        seeds = [CERT_SEED, trust_service.key().as_ref(), serial.as_ref()],
        bump
    )]
    pub certificate: Account<'info, Certificate>,
    /// CHECK: адрес закреплён константой Instructions sysvar
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_certificate(ctx: Context<RegisterCertificate>, serial: Vec<u8>) -> Result<()> {
    require!(!serial.is_empty() && serial.len() <= MAX_SERIAL_LEN, MorError::SerialMismatch);
    let ts = &ctx.accounts.trust_service;
    require!(ts.kind == TrustKind::P256Ca, MorError::UnsupportedTrustKind);

    // Предыдущая инструкция — самодостаточный прекомпайл secp256r1.
    let ix_sysvar = ctx.accounts.instructions.to_account_info();
    let current = load_current_index_checked(&ix_sysvar)? as usize;
    require!(current > 0, MorError::PrecompileMissing);
    let precompile = load_instruction_at_checked(current - 1, &ix_sysvar)?;
    require_keys_eq!(precompile.program_id, SECP256R1_PROGRAM_ID, MorError::PrecompileMissing);
    let verified = secp256r1::parse_self_contained(&precompile.data)?;

    // Подписал именно этот УЦ.
    require!(verified.pubkey == ts.pubkey, MorError::UntrustedKey);

    let now = Clock::get()?.unix_timestamp;
    let fields = evaluate_certificate(verified.message, now, &ts.subject_dn_hash)?;
    require!(fields.serial == serial.as_slice(), MorError::SerialMismatch);

    let cert = &mut ctx.accounts.certificate;
    cert.trust_service = ts.key();
    cert.serial = serial;
    cert.tbs_hash = hash(verified.message).to_bytes();
    cert.subject_key = fields.subject_key;
    cert.org_name = fields.org_name.to_string();
    cert.org_id = fields.org_id.to_string();
    cert.country = fields.country;
    cert.not_before = fields.not_before;
    cert.not_after = fields.not_after;
    cert.registered_at = now;
    cert.bump = ctx.bumps.certificate;
    Ok(())
}

pub struct CertFields<'a> {
    pub serial: &'a [u8],
    pub subject_key: [u8; 33],
    pub org_name: &'a str,
    pub org_id: &'a str,
    pub country: [u8; 2],
    pub not_before: i64,
    pub not_after: i64,
}

/// Политика реестра над разобранным TBS. Без аккаунтов, чтобы тестировать нативно.
pub fn evaluate_certificate<'a>(tbs: &'a [u8], now: i64, issuer_dn_hash: &[u8; 32]) -> Result<CertFields<'a>> {
    let info = x509::parse_tbs(tbs).map_err(x509_error)?;
    require!(info.sig_alg_oid == OID_ECDSA_WITH_SHA256, MorError::BadSignatureAlgorithm);
    require!(hash(info.issuer).to_bytes() == *issuer_dn_hash, MorError::IssuerMismatch);
    require!(info.serial.len() <= MAX_SERIAL_LEN, MorError::SerialMismatch);
    require!(now >= info.not_before, MorError::CertNotYetValid);
    require!(now <= info.not_after, MorError::CertExpired);
    require!(
        info.spki_alg_oid == OID_EC_PUBLIC_KEY
            && info.spki_params_oid == Some(OID_PRIME256V1)
            && info.public_key.len() == 65
            && info.public_key[0] == 0x04,
        MorError::UnsupportedKey
    );
    let (org_name, org_id) = match (info.org_name, info.org_id) {
        (Some(name), Some(id)) => (name, id),
        _ => return err!(MorError::MissingOrgAttributes),
    };
    // Сертификат сотрудника: имя и личный номер навсегда остались бы в данных транзакции.
    require!(!info.has_person_attrs, MorError::NaturalPersonCert);

    let mut subject_key = [0u8; 33];
    subject_key[0] = 0x02 | (info.public_key[64] & 1);
    subject_key[1..].copy_from_slice(&info.public_key[1..33]);

    Ok(CertFields {
        serial: info.serial,
        subject_key,
        org_name,
        org_id,
        country: info.country.unwrap_or([0, 0]),
        not_before: info.not_before,
        not_after: info.not_after,
    })
}

fn x509_error(e: X509Error) -> Error {
    match e {
        X509Error::FieldTooLong => error!(MorError::FieldTooLong),
        X509Error::Malformed | X509Error::BadTime => error!(MorError::DerMalformed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CA1: &[u8] = include_bytes!("../../../../fixtures/ca1.der");
    const EE_SMALL: &[u8] = include_bytes!("../../../../fixtures/ee_small.der");
    const EE_WRONG_ISSUER: &[u8] = include_bytes!("../../../../fixtures/ee_wrong_issuer.der");
    const EE_RSA: &[u8] = include_bytes!("../../../../fixtures/ee_rsa.der");
    const EE_NO_ORGID: &[u8] = include_bytes!("../../../../fixtures/ee_no_orgid.der");
    const EE_PERSON: &[u8] = include_bytes!("../../../../fixtures/ee_person.der");

    fn tbs(der: &[u8]) -> &[u8] {
        x509::split_certificate(der).unwrap().0
    }

    /// notBefore `ee_small` + 3 дня: фикстуры выпускаются в момент запуска gen.sh.
    fn now() -> i64 {
        x509::parse_tbs(tbs(EE_SMALL)).unwrap().not_before + 3 * 86_400
    }

    fn ca1_dn_hash() -> [u8; 32] {
        let info = x509::parse_tbs(tbs(CA1)).unwrap();
        hash(info.subject).to_bytes()
    }

    fn code(e: Error) -> u32 {
        match e {
            Error::AnchorError(a) => a.error_code_number,
            other => panic!("unexpected error {other:?}"),
        }
    }

    fn expect_err(res: Result<CertFields<'_>>, e: MorError) {
        assert_eq!(code(res.err().expect("must fail")), u32::from(e));
    }

    #[test]
    fn accepts_small_certificate() {
        let f = evaluate_certificate(tbs(EE_SMALL), now(), &ca1_dn_hash()).unwrap();
        assert_eq!(f.org_name, "Acme Robotics");
        assert_eq!(f.org_id, "NTREE-12345678");
        assert_eq!(f.country, *b"EE");
        assert!(f.subject_key[0] == 0x02 || f.subject_key[0] == 0x03);
        assert!(!f.serial.is_empty());
    }

    #[test]
    fn rejects_wrong_signature_algorithm() {
        let mut t = tbs(EE_SMALL).to_vec();
        let pos = t.windows(8).position(|w| w == OID_ECDSA_WITH_SHA256).unwrap();
        t[pos + 7] = 0x03; // ecdsa-with-SHA384
        expect_err(evaluate_certificate(&t, now(), &ca1_dn_hash()), MorError::BadSignatureAlgorithm);
    }

    #[test]
    fn rejects_issuer_mismatch() {
        expect_err(evaluate_certificate(tbs(EE_WRONG_ISSUER), now(), &ca1_dn_hash()), MorError::IssuerMismatch);
    }

    #[test]
    fn rejects_outside_validity() {
        let info = x509::parse_tbs(tbs(EE_SMALL)).unwrap();
        expect_err(evaluate_certificate(tbs(EE_SMALL), info.not_before - 1, &ca1_dn_hash()), MorError::CertNotYetValid);
        expect_err(evaluate_certificate(tbs(EE_SMALL), info.not_after + 1, &ca1_dn_hash()), MorError::CertExpired);
    }

    #[test]
    fn rejects_rsa_key() {
        expect_err(evaluate_certificate(tbs(EE_RSA), now(), &ca1_dn_hash()), MorError::UnsupportedKey);
    }

    #[test]
    fn rejects_missing_org_id() {
        expect_err(evaluate_certificate(tbs(EE_NO_ORGID), now(), &ca1_dn_hash()), MorError::MissingOrgAttributes);
    }

    #[test]
    fn rejects_natural_person() {
        expect_err(evaluate_certificate(tbs(EE_PERSON), now(), &ca1_dn_hash()), MorError::NaturalPersonCert);
    }

    #[test]
    fn rejects_garbage() {
        expect_err(evaluate_certificate(b"not der at all", now(), &ca1_dn_hash()), MorError::DerMalformed);
    }
}
