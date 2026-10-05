use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const TRUST_SEED: &[u8] = b"trust";
#[constant]
pub const CERT_SEED: &[u8] = b"cert";
#[constant]
pub const SEAL_SEED: &[u8] = b"seal";
/// Чтобы сообщение печати нельзя было выдать за DER (0x30/0x31) или TLS-контекст
pub const SEAL_TAG: &[u8] = b"MOR-SEAL-V1";
pub const MAX_SEAL_NAME_LEN: usize = 128;

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const TOKEN_2022_PROGRAM_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");
pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");

pub const MAX_SERIAL_LEN: usize = 20;
pub const MAX_NAME_LEN: usize = 64;
pub const MAX_ORG_NAME_LEN: usize = 128;
pub const MAX_ORG_ID_LEN: usize = 64;

// DER-кодировки OID без тега и длины
pub const OID_ECDSA_WITH_SHA256: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]; // 1.2.840.10045.4.3.2
pub const OID_EC_PUBLIC_KEY: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]; // 1.2.840.10045.2.1
pub const OID_PRIME256V1: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]; // 1.2.840.10045.3.1.7
pub const OID_O: &[u8] = &[0x55, 0x04, 0x0a]; // 2.5.4.10 organizationName
pub const OID_C: &[u8] = &[0x55, 0x04, 0x06]; // 2.5.4.6 countryName
pub const OID_ORG_ID: &[u8] = &[0x55, 0x04, 0x61]; // 2.5.4.97 organizationIdentifier
pub const OID_SURNAME: &[u8] = &[0x55, 0x04, 0x04]; // 2.5.4.4
pub const OID_GIVEN_NAME: &[u8] = &[0x55, 0x04, 0x2a]; // 2.5.4.42
pub const OID_SERIAL_NUMBER: &[u8] = &[0x55, 0x04, 0x05]; // 2.5.4.5
pub const OID_PSEUDONYM: &[u8] = &[0x55, 0x04, 0x41]; // 2.5.4.65

pub const OID_KEY_USAGE: &[u8] = &[0x55, 0x1d, 0x0f]; // 2.5.29.15
pub const OID_BASIC_CONSTRAINTS: &[u8] = &[0x55, 0x1d, 0x13]; // 2.5.29.19
pub const OID_EXT_KEY_USAGE: &[u8] = &[0x55, 0x1d, 0x25]; // 2.5.29.37
pub const OID_CERT_POLICIES: &[u8] = &[0x55, 0x1d, 0x20]; // 2.5.29.32
pub const OID_SUBJECT_ALT_NAME: &[u8] = &[0x55, 0x1d, 0x11]; // 2.5.29.17

// Запрещены для печатей: TLS 1.2 сервер подписывает чужой client_random, а TSA и OCSP подписывают чужие данные
pub const OID_KP_SERVER_AUTH: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x01]; // 1.3.6.1.5.5.7.3.1
pub const OID_KP_TIME_STAMPING: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x08]; // 1.3.6.1.5.5.7.3.8
pub const OID_KP_OCSP_SIGNING: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x09]; // 1.3.6.1.5.5.7.3.9

pub const KU_DIGITAL_SIGNATURE: u16 = 1 << 0;
pub const KU_NON_REPUDIATION: u16 = 1 << 1; // contentCommitment
pub const KU_KEY_CERT_SIGN: u16 = 1 << 5;
pub const KU_CRL_SIGN: u16 = 1 << 6;
