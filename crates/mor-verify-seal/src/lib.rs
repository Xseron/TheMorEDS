//! Проверка печати Mör из любой программы Solana: кто стоит за адресом и с каким доверием.
//!
//! ```ignore
//! let seal = mor_verify_seal::verify_seal(&seal_account, &owner, TrustLevel::Attestor)?;
//! ```
//!
//! Печать — аккаунт реестра Mör по адресу PDA `["seal", owner]`. Крейт не зависит от Anchor и от
//! кода реестра: раскладка аккаунта зафиксирована здесь, совпадение с реестром проверяет его тест.

use solana_account_info::AccountInfo;
use solana_clock::Clock;
use solana_program_error::ProgramError;
use solana_pubkey::{pubkey, Pubkey};
use solana_sysvar::Sysvar;

pub const MOR_REGISTRY_ID: Pubkey = pubkey!("CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP");
pub const SEAL_SEED: &[u8] = b"seal";
/// Дискриминатор Anchor: `sha256("account:Seal")[..8]`.
pub const SEAL_DISCRIMINATOR: [u8; 8] = [162, 149, 250, 10, 100, 125, 36, 168];
/// Все поля до `name` плюс длина строки.
pub const SEAL_MIN_LEN: usize = 194;
/// Коды ошибок крейта в `ProgramError::Custom`: 9100 + номер варианта `SealError`.
pub const ERROR_BASE: u32 = 9100;

/// Смещения полей в данных аккаунта (после 8 байт дискриминатора), спек недели 2.
mod offsets {
    pub const ADDRESS: usize = 8;
    pub const ADDRESS_KIND: usize = 40;
    pub const CONTROLLER: usize = 41;
    pub const TRUST_LEVEL: usize = 73;
    pub const JURISDICTION: usize = 74;
    pub const SUBJECT_TYPE: usize = 76;
    pub const IDENTIFIER_HASH: usize = 77;
    pub const TRUST_SERVICE: usize = 109;
    pub const CERTIFICATE: usize = 141;
    pub const EXPIRES_AT: usize = 173;
    pub const CREATED_AT: usize = 181;
    pub const BUMP: usize = 189;
}

/// Уровень доверия; больше — сильнее.
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum TrustLevel {
    /// Подпись проверил аттестатор вне сети (НУЦ РК).
    Attestor = 0,
    /// Подпись и сертификат проверены в сети (eIDAS).
    Trustless = 1,
}

impl TrustLevel {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Attestor),
            1 => Some(Self::Trustless),
            _ => None,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddressKind {
    Wallet = 0,
    Program = 1,
    Mint = 2,
}

impl AddressKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Wallet),
            1 => Some(Self::Program),
            2 => Some(Self::Mint),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SealError {
    /// Аккаунт не принадлежит реестру: печати нет или она отозвана.
    NotSealed = 0,
    /// Аккаунт реестра, но не печать этого адреса.
    WrongAccount = 1,
    Expired = 2,
    TrustTooLow = 3,
}

impl From<SealError> for ProgramError {
    fn from(e: SealError) -> Self {
        ProgramError::Custom(ERROR_BASE + e as u32)
    }
}

/// Поля печати, нужные программе-потребителю. Название организации читает страница через RPC.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Seal {
    pub address: Pubkey,
    pub address_kind: AddressKind,
    pub controller: Pubkey,
    pub trust_level: TrustLevel,
    pub jurisdiction: [u8; 2],
    /// 0 — юридическое лицо.
    pub subject_type: u8,
    pub identifier_hash: [u8; 32],
    pub trust_service: Pubkey,
    /// `None` для печатей аттестатора.
    pub certificate: Option<Pubkey>,
    pub expires_at: i64,
    pub created_at: i64,
}

/// Печать адреса `owner` действует сейчас и её уровень не ниже `min`.
pub fn verify_seal(seal: &AccountInfo, owner: &Pubkey, min: TrustLevel) -> Result<Seal, ProgramError> {
    let now = Clock::get()?.unix_timestamp;
    Ok(verify_seal_at(seal, owner, min, now)?)
}

/// То же с явным временем (для тестов и офчейн-проверок).
pub fn verify_seal_at(seal: &AccountInfo, owner: &Pubkey, min: TrustLevel, now: i64) -> Result<Seal, SealError> {
    if seal.owner != &MOR_REGISTRY_ID {
        return Err(SealError::NotSealed);
    }
    let data = seal.try_borrow_data().map_err(|_| SealError::WrongAccount)?;
    let (parsed, bump) = parse(&data).ok_or(SealError::WrongAccount)?;
    let expected = Pubkey::create_program_address(&[SEAL_SEED, owner.as_ref(), &[bump]], &MOR_REGISTRY_ID)
        .map_err(|_| SealError::WrongAccount)?;
    if expected != *seal.key || parsed.address != *owner {
        return Err(SealError::WrongAccount);
    }
    if now >= parsed.expires_at {
        return Err(SealError::Expired);
    }
    if parsed.trust_level < min {
        return Err(SealError::TrustTooLow);
    }
    Ok(parsed)
}

fn parse(d: &[u8]) -> Option<(Seal, u8)> {
    use offsets::*;
    if d.len() < SEAL_MIN_LEN || d[..8] != SEAL_DISCRIMINATOR {
        return None;
    }
    let key = |o: usize| Pubkey::new_from_array(d[o..o + 32].try_into().unwrap());
    let i64_at = |o: usize| i64::from_le_bytes(d[o..o + 8].try_into().unwrap());
    let certificate = key(CERTIFICATE);
    let seal = Seal {
        address: key(ADDRESS),
        address_kind: AddressKind::from_u8(d[ADDRESS_KIND])?,
        controller: key(CONTROLLER),
        trust_level: TrustLevel::from_u8(d[TRUST_LEVEL])?,
        jurisdiction: [d[JURISDICTION], d[JURISDICTION + 1]],
        subject_type: d[SUBJECT_TYPE],
        identifier_hash: d[IDENTIFIER_HASH..IDENTIFIER_HASH + 32].try_into().unwrap(),
        trust_service: key(TRUST_SERVICE),
        certificate: (certificate != Pubkey::default()).then_some(certificate),
        expires_at: i64_at(EXPIRES_AT),
        created_at: i64_at(CREATED_AT),
    };
    Some((seal, d[BUMP]))
}

/// Данные аккаунта печати в раскладке реестра — для тестов программ-потребителей.
#[cfg(any(test, feature = "test-utils"))]
pub mod test_utils {
    use super::{offsets::*, *};

    /// Печать кошелька `owner` (юрлицо, EE, без названия); возвращает (PDA, данные аккаунта).
    pub fn seal_account(owner: &Pubkey, trust_level: TrustLevel, expires_at: i64) -> (Pubkey, Vec<u8>) {
        let (pda, bump) = Pubkey::find_program_address(&[SEAL_SEED, owner.as_ref()], &MOR_REGISTRY_ID);
        let mut d = vec![0u8; SEAL_MIN_LEN];
        d[..8].copy_from_slice(&SEAL_DISCRIMINATOR);
        d[ADDRESS..ADDRESS + 32].copy_from_slice(owner.as_ref());
        d[ADDRESS_KIND] = AddressKind::Wallet as u8;
        d[CONTROLLER..CONTROLLER + 32].copy_from_slice(owner.as_ref());
        d[TRUST_LEVEL] = trust_level as u8;
        d[JURISDICTION..JURISDICTION + 2].copy_from_slice(b"EE");
        d[EXPIRES_AT..EXPIRES_AT + 8].copy_from_slice(&expires_at.to_le_bytes());
        d[BUMP] = bump;
        (pda, d)
    }
}

#[cfg(test)]
mod tests {
    use super::{test_utils::seal_account, *};

    fn check(program: &Pubkey, key: &Pubkey, data: &mut [u8], owner: &Pubkey, min: TrustLevel, now: i64) -> Result<Seal, SealError> {
        let mut lamports = 1u64;
        let info = AccountInfo::new(key, false, false, &mut lamports, data, program, false);
        verify_seal_at(&info, owner, min, now)
    }

    #[test]
    fn accepts_valid_and_rejects_expired_weak_or_foreign_seal() {
        let owner = Pubkey::new_from_array([9; 32]);
        let (pda, mut data) = seal_account(&owner, TrustLevel::Attestor, 1_000);

        let seal = check(&MOR_REGISTRY_ID, &pda, &mut data, &owner, TrustLevel::Attestor, 999).unwrap();
        assert_eq!(seal.address, owner);
        assert_eq!(seal.certificate, None);

        assert_eq!(check(&MOR_REGISTRY_ID, &pda, &mut data, &owner, TrustLevel::Attestor, 1_000), Err(SealError::Expired));
        assert_eq!(check(&MOR_REGISTRY_ID, &pda, &mut data, &owner, TrustLevel::Trustless, 999), Err(SealError::TrustTooLow));
        let stranger = Pubkey::new_from_array([1; 32]);
        assert_eq!(check(&stranger, &pda, &mut data, &owner, TrustLevel::Attestor, 999), Err(SealError::NotSealed));
        let other_owner = Pubkey::new_from_array([8; 32]);
        assert_eq!(check(&MOR_REGISTRY_ID, &pda, &mut data, &other_owner, TrustLevel::Attestor, 999), Err(SealError::WrongAccount));
        assert_eq!(ProgramError::from(SealError::NotSealed), ProgramError::Custom(9100));
    }
}
