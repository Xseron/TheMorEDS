use anchor_lang::prelude::*;

/// Единственный админ реестра: добавляет удостоверяющие центры.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TrustKind {
    /// УЦ с ключом P-256: подпись над сертификатом проверяет прекомпайл secp256r1.
    P256Ca,
    /// Аттестатор с ключом Ed25519 (НУЦ РК). Зарезервировано, на неделе 1 не принимается.
    Attestor,
}

/// Удостоверяющий центр из доверенного списка. PDA: ["trust", spki_hash].
#[account]
#[derive(InitSpace)]
pub struct TrustService {
    pub kind: TrustKind,
    /// Сжатый SEC1 (P256Ca) или Ed25519 в первых 32 байтах (Attestor).
    pub pubkey: [u8; 33],
    /// sha256 полного TLV SubjectPublicKeyInfo сертификата УЦ.
    pub spki_hash: [u8; 32],
    /// sha256 полного TLV Name субъекта УЦ — сравнивается с issuer сертификата.
    pub subject_dn_hash: [u8; 32],
    #[max_len(64)]
    pub name: String,
    pub country: [u8; 2],
    pub bump: u8,
}

/// Зарегистрированный сертификат юридического лица. PDA: ["cert", trust_service, serial].
#[account]
#[derive(InitSpace)]
pub struct Certificate {
    pub trust_service: Pubkey,
    /// Содержимое DER INTEGER как есть.
    #[max_len(20)]
    pub serial: Vec<u8>,
    /// sha256 полного TLV TBSCertificate.
    pub tbs_hash: [u8; 32],
    /// Сжатый SEC1 ключ субъекта — им организация будет подписывать Seal.
    pub subject_key: [u8; 33],
    #[max_len(128)]
    pub org_name: String,
    #[max_len(64)]
    pub org_id: String,
    /// `[0, 0]`, если атрибута C нет.
    pub country: [u8; 2],
    pub not_before: i64,
    pub not_after: i64,
    pub registered_at: i64,
    pub bump: u8,
}
