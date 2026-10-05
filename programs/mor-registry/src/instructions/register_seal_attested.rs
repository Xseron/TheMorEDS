use anchor_lang::prelude::*;

use crate::{
    constants::*,
    controller,
    error::MorError,
    precompile,
    seal_message::SealMessage,
    state::{AddressKind, Seal, SubjectType, TrustKind, TrustLevel, TrustService},
};

/// Аттестатор проверил ГОСТ-подпись НУЦ РК вне сети и подписал сообщение Ed25519
/// ПДн подписанта в сообщение не попадают, только название организации и хэш БИН с солью
#[derive(Accounts)]
pub struct RegisterSealAttested<'info> {
    #[account(mut)]
    pub controller: Signer<'info>,
    /// CHECK: проверяется в controller::controls
    pub address: UncheckedAccount<'info>,
    /// CHECK: ProgramData при kind = Program, проверяется в controller::controls
    pub program_data: Option<UncheckedAccount<'info>>,
    pub trust_service: Account<'info, TrustService>,
    #[account(
        init,
        payer = controller,
        space = 8 + Seal::INIT_SPACE,
        seeds = [SEAL_SEED, address.key().as_ref()],
        bump
    )]
    pub seal: Account<'info, Seal>,
    /// CHECK: адрес закреплён на Instructions sysvar
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_seal_attested(
    ctx: Context<RegisterSealAttested>,
    kind: AddressKind,
    identifier_hash: [u8; 32],
    name: String,
    expires_at: i64,
    sign_deadline: i64,
) -> Result<()> {
    let data = precompile::previous_instruction_data(&ctx.accounts.instructions, &ED25519_PROGRAM_ID)?;
    let verified = precompile::parse_self_contained(&data, precompile::ED25519_KEY_LEN)?;

    let ts = &ctx.accounts.trust_service;
    require!(ts.kind == TrustKind::Attestor, MorError::UnsupportedTrustKind);
    require!(verified.pubkey == &ts.pubkey[..32], MorError::UntrustedKey);

    let controller = ctx.accounts.controller.key();
    let address = ctx.accounts.address.to_account_info();
    let program_data = ctx.accounts.program_data.as_ref().map(|a| a.to_account_info());
    require!(
        controller::controls(kind, &address, program_data.as_ref(), &controller),
        MorError::NotController
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now <= sign_deadline, MorError::SignDeadlinePassed);
    // Верхнюю границу срока аттестатор берёт из сертификата НУЦ
    require!(now < expires_at, MorError::InvalidExpiry);
    require!(!name.is_empty(), MorError::MissingOrgAttributes);
    require!(name.len() <= MAX_SEAL_NAME_LEN, MorError::FieldTooLong);
    require!(ts.country != [0, 0], MorError::MissingJurisdiction);

    let expected = SealMessage {
        address: address.key,
        address_kind: kind,
        controller: &controller,
        trust_level: TrustLevel::Attestor,
        trust_service: &ts.key(),
        certificate: &Pubkey::default(),
        jurisdiction: ts.country,
        subject_type: SubjectType::LegalEntity,
        identifier_hash: &identifier_hash,
        expires_at,
        sign_deadline,
        name: &name,
    }
    .to_bytes();
    require!(verified.message == expected.as_slice(), MorError::SealMessageMismatch);

    let (trust_service, country) = (ts.key(), ts.country);
    let seal = &mut ctx.accounts.seal;
    seal.address = *address.key;
    seal.address_kind = kind;
    seal.controller = controller;
    seal.trust_level = TrustLevel::Attestor;
    seal.jurisdiction = country;
    seal.subject_type = SubjectType::LegalEntity;
    seal.identifier_hash = identifier_hash;
    seal.trust_service = trust_service;
    seal.certificate = Pubkey::default();
    seal.expires_at = expires_at;
    seal.created_at = now;
    seal.bump = ctx.bumps.seal;
    seal.name = name;
    Ok(())
}
