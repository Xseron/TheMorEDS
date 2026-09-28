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
