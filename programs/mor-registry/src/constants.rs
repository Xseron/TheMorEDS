use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const TRUST_SEED: &[u8] = b"trust";
#[constant]
pub const CERT_SEED: &[u8] = b"cert";

/// Прекомпайл проверки подписей P-256 (SIMD-0075).
pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");

pub const MAX_SERIAL_LEN: usize = 20;
pub const MAX_NAME_LEN: usize = 64;
pub const MAX_ORG_NAME_LEN: usize = 128;
pub const MAX_ORG_ID_LEN: usize = 64;

// DER-кодировки OID без тега и длины.
pub const OID_ECDSA_WITH_SHA256: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]; // 1.2.840.10045.4.3.2
pub const OID_EC_PUBLIC_KEY: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]; // 1.2.840.10045.2.1
pub const OID_PRIME256V1: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]; // 1.2.840.10045.3.1.7
pub const OID_O: &[u8] = &[0x55, 0x04, 0x0a]; // 2.5.4.10 organizationName
pub const OID_C: &[u8] = &[0x55, 0x04, 0x06]; // 2.5.4.6 countryName
pub const OID_ORG_ID: &[u8] = &[0x55, 0x04, 0x61]; // 2.5.4.97 organizationIdentifier
pub const OID_SURNAME: &[u8] = &[0x55, 0x04, 0x04]; // 2.5.4.4
pub const OID_GIVEN_NAME: &[u8] = &[0x55, 0x04, 0x2a]; // 2.5.4.42
pub const OID_SERIAL_NUMBER: &[u8] = &[0x55, 0x04, 0x05]; // 2.5.4.5
