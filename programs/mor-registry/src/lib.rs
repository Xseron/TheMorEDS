pub mod constants;
pub mod controller;
pub mod error;
pub mod instructions;
pub mod precompile;
pub mod seal_message;
pub mod state;
pub mod x509;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP");

#[program]
pub mod mor_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }

    pub fn add_trust_service(
        ctx: Context<AddTrustService>,
        kind: TrustKind,
        pubkey: [u8; 33],
        spki_hash: [u8; 32],
        subject_dn_hash: [u8; 32],
        name: String,
        country: [u8; 2],
    ) -> Result<()> {
        crate::instructions::add_trust_service::handle_add_trust_service(
            ctx, kind, pubkey, spki_hash, subject_dn_hash, name, country,
        )
    }

    pub fn register_certificate(ctx: Context<RegisterCertificate>, serial: Vec<u8>) -> Result<()> {
        crate::instructions::register_certificate::handle_register_certificate(ctx, serial)
    }

    pub fn register_seal_p256(
        ctx: Context<RegisterSealP256>,
        kind: AddressKind,
        salt: [u8; 32],
        expires_at: i64,
        sign_deadline: i64,
    ) -> Result<()> {
        crate::instructions::register_seal_p256::handle_register_seal_p256(ctx, kind, salt, expires_at, sign_deadline)
    }
}
