use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::MorError,
    state::{Config, TrustKind, TrustService},
};

#[derive(Accounts)]
#[instruction(kind: TrustKind, pubkey: [u8; 33], spki_hash: [u8; 32])]
pub struct AddTrustService<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MorError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + TrustService::INIT_SPACE,
        seeds = [TRUST_SEED, spki_hash.as_ref()],
        bump
    )]
    pub trust_service: Account<'info, TrustService>,
    pub system_program: Program<'info, System>,
}

pub fn handle_add_trust_service(
    ctx: Context<AddTrustService>,
    kind: TrustKind,
    pubkey: [u8; 33],
    spki_hash: [u8; 32],
    subject_dn_hash: [u8; 32],
    name: String,
    country: [u8; 2],
) -> Result<()> {
    require!(kind == TrustKind::P256Ca, MorError::UnsupportedTrustKind);
    require!(pubkey[0] == 0x02 || pubkey[0] == 0x03, MorError::UntrustedKey);
    require!(name.len() <= MAX_NAME_LEN, MorError::FieldTooLong);

    let ts = &mut ctx.accounts.trust_service;
    ts.kind = kind;
    ts.pubkey = pubkey;
    ts.spki_hash = spki_hash;
    ts.subject_dn_hash = subject_dn_hash;
    ts.name = name;
    ts.country = country;
    ts.bump = ctx.bumps.trust_service;
    Ok(())
}
