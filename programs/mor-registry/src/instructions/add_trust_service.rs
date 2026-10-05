use anchor_lang::prelude::*;
use solana_sha256_hasher::hash;

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
    match kind {
        TrustKind::P256Ca => require!(pubkey[0] == 0x02 || pubkey[0] == 0x03, MorError::UntrustedKey),
        // Ed25519-ключ в первых 32 байтах, сид PDA = sha256 ключа, DN у аттестатора нет
        TrustKind::Attestor => require!(
            pubkey[32] == 0 && spki_hash == hash(&pubkey[..32]).to_bytes() && subject_dn_hash == [0u8; 32],
            MorError::BadAttestorKey
        ),
    }
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
