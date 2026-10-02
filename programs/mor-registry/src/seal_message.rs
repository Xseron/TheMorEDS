//! Сообщение, которое подписывает организация (или аттестатор), чтобы запечатать адрес.
//! Раскладка фиксирована спеком недели 2 («Подписываемое сообщение»); её же собирают TS-клиент
//! и Go-аттестатор, поэтому поля не меняются без новой версии тега.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::{
    constants::SEAL_TAG,
    state::{AddressKind, SubjectType, TrustLevel},
};

pub struct SealMessage<'a> {
    pub address: &'a Pubkey,
    pub address_kind: AddressKind,
    pub controller: &'a Pubkey,
    pub trust_level: TrustLevel,
    pub trust_service: &'a Pubkey,
    /// Нули для аттестатора.
    pub certificate: &'a Pubkey,
    pub jurisdiction: [u8; 2],
    pub subject_type: SubjectType,
    pub identifier_hash: &'a [u8; 32],
    pub expires_at: i64,
    pub sign_deadline: i64,
    /// 1..=128 байт UTF-8; длину проверяет вызывающий.
    pub name: &'a str,
}

impl SealMessage<'_> {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(225 + self.name.len());
        out.extend_from_slice(SEAL_TAG);
        out.extend_from_slice(crate::ID.as_ref());
        out.extend_from_slice(self.address.as_ref());
        out.push(self.address_kind as u8);
        out.extend_from_slice(self.controller.as_ref());
        out.push(self.trust_level as u8);
        out.extend_from_slice(self.trust_service.as_ref());
        out.extend_from_slice(self.certificate.as_ref());
        out.extend_from_slice(&self.jurisdiction);
        out.push(self.subject_type as u8);
        out.extend_from_slice(self.identifier_hash);
        out.extend_from_slice(&self.expires_at.to_le_bytes());
        out.extend_from_slice(&self.sign_deadline.to_le_bytes());
        out.push(self.name.len() as u8);
        out.extend_from_slice(self.name.as_bytes());
        out
    }
}

/// `sha256(salt ‖ jurisdiction ‖ identifier)`: идентификатор организации без раскрытия,
/// владелец показывает (identifier, salt) контрагенту вне сети.
pub fn identifier_hash(salt: &[u8; 32], jurisdiction: [u8; 2], identifier: &str) -> [u8; 32] {
    hashv(&[salt, &jurisdiction, identifier.as_bytes()]).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Смещения — из спека недели 2; их же используют TS-клиент и Go-аттестатор.
    #[test]
    fn layout_matches_spec_offsets() {
        let (address, controller) = (Pubkey::new_from_array([1; 32]), Pubkey::new_from_array([2; 32]));
        let (trust_service, certificate) = (Pubkey::new_from_array([3; 32]), Pubkey::new_from_array([4; 32]));
        let name = "ТОО «Ромашка»";
        let m = SealMessage {
            address: &address,
            address_kind: AddressKind::Mint,
            controller: &controller,
            trust_level: TrustLevel::Trustless,
            trust_service: &trust_service,
            certificate: &certificate,
            jurisdiction: *b"KZ",
            subject_type: SubjectType::LegalEntity,
            identifier_hash: &[5; 32],
            expires_at: 0x0102_0304_0506_0708,
            sign_deadline: -1,
            name,
        }
        .to_bytes();
        assert_eq!(&m[0..11], b"MOR-SEAL-V1");
        assert_eq!(&m[11..43], crate::ID.as_ref());
        assert_eq!(&m[43..75], &[1; 32]);
        assert_eq!(m[75], 2);
        assert_eq!(&m[76..108], &[2; 32]);
        assert_eq!(m[108], 1);
        assert_eq!(&m[109..141], &[3; 32]);
        assert_eq!(&m[141..173], &[4; 32]);
        assert_eq!(&m[173..175], b"KZ");
        assert_eq!(m[175], 0);
        assert_eq!(&m[176..208], &[5; 32]);
        assert_eq!(&m[208..216], &0x0102_0304_0506_0708i64.to_le_bytes());
        assert_eq!(&m[216..224], &[0xff; 8]);
        // Длина — в байтах UTF-8, не в символах.
        assert_eq!(m[224] as usize, name.len());
        assert_eq!(&m[225..], name.as_bytes());

        // Эталон из спека аттестатора (неделя 3): Go-аттестатор сверяет свои байты с тем же hex.
        let hex: String = m.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "4d4f522d5345414c2d5631afe3ef75354d140f003334108037ea07df2cfdad47b65d62fa7a5d78f63d0fb0010101010101010101010101010101010101010101010101010101010101010102020202020202020202020202020202020202020202020202020202020202020201030303030303030303030303030303030303030303030303030303030303030304040404040404040404040404040404040404040404040404040404040404044b5a0005050505050505050505050505050505050505050505050505050505050505050807060504030201ffffffffffffffff19d0a2d09ed09e20c2abd0a0d0bed0bcd0b0d188d0bad0b0c2bb"
        );
    }
}
