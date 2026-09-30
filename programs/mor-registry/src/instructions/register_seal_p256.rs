use anchor_lang::prelude::*;

use crate::{
    constants::*,
    controller,
    error::MorError,
    precompile,
    seal_message::{self, SealMessage},
    state::{AddressKind, Certificate, Seal, SubjectType, TrustKind, TrustLevel, TrustService},
};

/// Печать eIDAS: ключ сертификата организации подписывает сообщение (прекомпайл secp256r1
/// прямо перед этой инструкцией), контролёр адреса подписывает транзакцию и платит аренду.
#[derive(Accounts)]
pub struct RegisterSealP256<'info> {
    #[account(mut)]
    pub controller: Signer<'info>,
    /// CHECK: запечатываемый адрес; контроль проверяет controller::controls
    pub address: UncheckedAccount<'info>,
    /// CHECK: ProgramData для kind = Program; проверяется в controller::controls
    pub program_data: Option<UncheckedAccount<'info>>,
    pub trust_service: Account<'info, TrustService>,
    #[account(has_one = trust_service @ MorError::IssuerMismatch)]
    pub certificate: Account<'info, Certificate>,
    #[account(
        init,
        payer = controller,
        space = 8 + Seal::INIT_SPACE,
        seeds = [SEAL_SEED, address.key().as_ref()],
        bump
    )]
    pub seal: Account<'info, Seal>,
    /// CHECK: адрес закреплён константой Instructions sysvar
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_seal_p256(
    ctx: Context<RegisterSealP256>,
    kind: AddressKind,
    salt: [u8; 32],
    expires_at: i64,
    sign_deadline: i64,
) -> Result<()> {
    let data = precompile::previous_instruction_data(&ctx.accounts.instructions, &SECP256R1_PROGRAM_ID)?;
    let verified = precompile::parse_self_contained(&data, precompile::SECP256R1_KEY_LEN)?;

    let ts = &ctx.accounts.trust_service;
    require!(ts.kind == TrustKind::P256Ca, MorError::UnsupportedTrustKind);
    let cert = &ctx.accounts.certificate;
    require!(verified.pubkey == cert.subject_key, MorError::UntrustedKey);

    let controller = ctx.accounts.controller.key();
    let address = ctx.accounts.address.to_account_info();
    let program_data = ctx.accounts.program_data.as_ref().map(|a| a.to_account_info());
    require!(
        controller::controls(kind, &address, program_data.as_ref(), &controller),
        MorError::NotController
    );

    let now = Clock::get()?.unix_timestamp;
    require!(now >= cert.not_before, MorError::CertNotYetValid);
    require!(now <= cert.not_after, MorError::CertExpired);
    require!(now <= sign_deadline, MorError::SignDeadlinePassed);
    require!(now < expires_at && expires_at <= cert.not_after, MorError::InvalidExpiry);
    require!(cert.country != [0, 0], MorError::MissingJurisdiction);

    let identifier_hash = seal_message::identifier_hash(&salt, cert.country, &cert.org_id);
    let expected = SealMessage {
        address: address.key,
        address_kind: kind,
        controller: &controller,
        trust_level: TrustLevel::Trustless,
        trust_service: &ts.key(),
        certificate: &cert.key(),
        jurisdiction: cert.country,
        subject_type: SubjectType::LegalEntity,
        identifier_hash: &identifier_hash,
        expires_at,
        sign_deadline,
        name: &cert.org_name,
    }
    .to_bytes();
    require!(verified.message == expected.as_slice(), MorError::SealMessageMismatch);

    let (trust_service, certificate, country, name) = (ts.key(), cert.key(), cert.country, cert.org_name.clone());
    let seal = &mut ctx.accounts.seal;
    seal.address = *address.key;
    seal.address_kind = kind;
    seal.controller = controller;
    seal.trust_level = TrustLevel::Trustless;
    seal.jurisdiction = country;
    seal.subject_type = SubjectType::LegalEntity;
    seal.identifier_hash = identifier_hash;
    seal.trust_service = trust_service;
    seal.certificate = certificate;
    seal.expires_at = expires_at;
    seal.created_at = now;
    seal.bump = ctx.bumps.seal;
    seal.name = name;
    Ok(())
}
