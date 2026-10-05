use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

use crate::{
    constants::*,
    error::MorError,
    precompile,
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
    /// CHECK: адрес закреплён на Instructions sysvar
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_certificate(ctx: Context<RegisterCertificate>, serial: Vec<u8>) -> Result<()> {
    require!(!serial.is_empty() && serial.len() <= MAX_SERIAL_LEN, MorError::SerialMismatch);
    let ts = &ctx.accounts.trust_service;
    require!(ts.kind == TrustKind::P256Ca, MorError::UnsupportedTrustKind);

    let data = precompile::previous_instruction_data(&ctx.accounts.instructions, &SECP256R1_PROGRAM_ID)?;
    let verified = precompile::parse_self_contained(&data, precompile::SECP256R1_KEY_LEN)?;

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

/// Отдельно от аккаунтов, чтобы тестировать нативно
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
    // Только конечный сертификат подписи, не УЦ. Незнакомое критичное расширение RFC 5280 §4.2 велит отвергать
    let signing = KU_DIGITAL_SIGNATURE | KU_NON_REPUDIATION;
    let issuing = KU_KEY_CERT_SIGN | KU_CRL_SIGN;
    require!(
        !info.ca
            && !info.unknown_critical
            && info.key_usage.is_some_and(|ku| ku & signing != 0 && ku & issuing == 0),
        MorError::NotEndEntity
    );
    // TLS-сервер, TSA и OCSP подписывают данные, частично выбранные посторонними
    require!(!info.forbidden_purpose, MorError::ForbiddenKeyPurpose);
    let (org_name, org_id) = match (info.org_name, info.org_id) {
        (Some(name), Some(id)) if !name.is_empty() && !id.is_empty() => (name, id),
        _ => return err!(MorError::MissingOrgAttributes),
    };
    // Только страховка: TBS уже в транзакции, ПДн в сеть не пускает проверка в клиенте (scripts/devnet-v1)
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

    /// notBefore `ee_small` + 3 дня: фикстуры выпускаются в момент запуска gen.sh
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
    fn rejects_ca_certificate() {
        // Субъект УЦ проходит все проверки, отсечь его должны CA:TRUE и keyCertSign/cRLSign
        expect_err(evaluate_certificate(tbs(CA1), now(), &ca1_dn_hash()), MorError::NotEndEntity);
    }

    #[test]
    fn end_entity_policy_on_extensions() {
        use x509::test_der::{basic_constraints, extension, extensions, key_usage, replace_extensions};
        let ku = |unused: u8, bits: u8| extension(OID_KEY_USAGE, true, &key_usage(unused, &[bits]));
        let bc = |ca: bool| extension(OID_BASIC_CONSTRAINTS, true, &basic_constraints(ca));
        let unknown_critical = extension(&[0x2a, 0x03, 0x04], true, &[0x05, 0x00]);
        let unknown_non_critical = extension(&[0x2a, 0x03, 0x04], false, &[0x05, 0x00]);
        let with = |exts: Vec<Vec<u8>>| {
            let tail = if exts.is_empty() { vec![] } else { extensions(&exts) };
            replace_extensions(tbs(EE_SMALL), &tail)
        };

        let accepted = [
            ("digitalSignature", vec![ku(7, 0x80)]),
            ("nonRepudiation", vec![ku(6, 0x40)]),
            ("CA:FALSE, digitalSignature + nonRepudiation", vec![bc(false), ku(6, 0xc0)]),
            ("unknown non-critical extension", vec![ku(6, 0x40), unknown_non_critical]),
        ];
        for (why, exts) in accepted {
            let t = with(exts);
            assert!(evaluate_certificate(&t, now(), &ca1_dn_hash()).is_ok(), "{why} must be accepted");
        }

        let rejected = [
            ("no extensions", vec![]),
            ("keyUsage absent", vec![bc(false)]),
            ("keyEncipherment only", vec![ku(5, 0x20)]),
            ("digitalSignature + keyCertSign", vec![ku(2, 0x84)]),
            ("nonRepudiation + cRLSign", vec![ku(1, 0x42)]),
            ("CA:TRUE", vec![bc(true), ku(6, 0x40)]),
            ("unknown critical extension", vec![ku(6, 0x40), unknown_critical]),
        ];
        for (why, exts) in rejected {
            let t = with(exts);
            let err = evaluate_certificate(&t, now(), &ca1_dn_hash()).err().unwrap_or_else(|| panic!("{why} must fail"));
            assert_eq!(code(err), u32::from(MorError::NotEndEntity), "{why}");
        }
    }

    #[test]
    fn rejects_garbage() {
        expect_err(evaluate_certificate(b"not der at all", now(), &ca1_dn_hash()), MorError::DerMalformed);
    }
}
