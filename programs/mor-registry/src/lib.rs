pub mod constants;
pub mod error;
pub mod instructions;
pub mod secp256r1;
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
}
