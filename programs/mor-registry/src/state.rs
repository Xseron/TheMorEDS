use anchor_lang::prelude::*;

/// Админ реестра, только он добавляет УЦ
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TrustKind {
    P256Ca,
    /// Аттестатор НУЦ РК с ключом Ed25519
    Attestor,
}

/// PDA: ["trust", spki_hash]
#[account]
#[derive(InitSpace)]
pub struct TrustService {
    pub kind: TrustKind,
    /// Сжатый SEC1 (P256Ca) или Ed25519 в первых 32 байтах (Attestor)
    pub pubkey: [u8; 33],
    /// sha256 полного TLV SubjectPublicKeyInfo сертификата УЦ
    pub spki_hash: [u8; 32],
    /// sha256 полного TLV Name субъекта УЦ, сверяется с issuer сертификата
    pub subject_dn_hash: [u8; 32],
    #[max_len(64)]
    pub name: String,
    pub country: [u8; 2],
    pub bump: u8,
}

/// Сертификат юрлица. PDA: ["cert", trust_service, serial]
#[account]
#[derive(InitSpace)]
pub struct Certificate {
    pub trust_service: Pubkey,
    /// Содержимое DER INTEGER как есть
    #[max_len(20)]
    pub serial: Vec<u8>,
    /// sha256 полного TLV TBSCertificate
    pub tbs_hash: [u8; 32],
    /// Сжатый SEC1, им организация подписывает сообщение печати
    pub subject_key: [u8; 33],
    #[max_len(128)]
    pub org_name: String,
    #[max_len(64)]
    pub org_id: String,
    /// `[0, 0]`, если атрибута C нет
    pub country: [u8; 2],
    pub not_before: i64,
    pub not_after: i64,
    pub registered_at: i64,
    pub bump: u8,
}

/// Номер варианта пишется байтом в аккаунт и в подписанное сообщение
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AddressKind {
    Wallet,
    Program,
    Mint,
}

/// Больше значит сильнее, потребители сравнивают через `>=`
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TrustLevel {
    /// Подпись проверена аттестатором вне сети
    Attestor,
    /// Подпись и сертификат проверены в сети
    Trustless,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SubjectType {
    LegalEntity,
}

/// PDA: ["seal", address]. Порядок полей не менять: `mor-verify-seal` читает их по смещениям
#[account]
#[derive(InitSpace)]
pub struct Seal {
    pub address: Pubkey,
    pub address_kind: AddressKind,
    /// Кошелёк, upgrade authority или mint authority, давший согласие на печать
    pub controller: Pubkey,
    pub trust_level: TrustLevel,
    /// ISO 3166-1 alpha-2
    pub jurisdiction: [u8; 2],
    pub subject_type: SubjectType,
    /// sha256(salt || jurisdiction || identifier)
    pub identifier_hash: [u8; 32],
    pub trust_service: Pubkey,
    /// PDA Certificate; нули для аттестатора
    pub certificate: Pubkey,
    pub expires_at: i64,
    pub created_at: i64,
    pub bump: u8,
    #[max_len(128)]
    pub name: String,
}
