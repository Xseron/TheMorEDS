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
    /// Аттестатор с ключом Ed25519 (НУЦ РК): ключ в первых 32 байтах pubkey, путь register_seal_attested.
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

/// Что запечатано. Номер варианта — байт в аккаунте и в подписанном сообщении.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AddressKind {
    Wallet,
    Program,
    Mint,
}

/// Уровень доверия; больше — сильнее, потребитель сравнивает `>=`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TrustLevel {
    /// Подпись проверил аттестатор вне сети (НУЦ РК).
    Attestor,
    /// Подпись и сертификат проверены в сети (eIDAS, P-256).
    Trustless,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SubjectType {
    LegalEntity,
}

/// Печать: кто стоит за адресом. PDA: ["seal", address]. Порядок полей фиксирован — крейт
/// `mor-verify-seal` читает их по смещениям (спек недели 2, «Аккаунты»).
#[account]
#[derive(InitSpace)]
pub struct Seal {
    pub address: Pubkey,
    pub address_kind: AddressKind,
    /// Кто дал согласие при печати: кошелёк / upgrade authority / mint authority.
    pub controller: Pubkey,
    pub trust_level: TrustLevel,
    /// ISO 3166-1 alpha-2.
    pub jurisdiction: [u8; 2],
    pub subject_type: SubjectType,
    /// sha256(salt ‖ jurisdiction ‖ identifier).
    pub identifier_hash: [u8; 32],
    pub trust_service: Pubkey,
    /// PDA Certificate; нули для аттестатора.
    pub certificate: Pubkey,
    pub expires_at: i64,
    pub created_at: i64,
    pub bump: u8,
    #[max_len(128)]
    pub name: String,
}
