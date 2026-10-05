//! Демо transfer hook Token-2022: перевод проходит, только если у владельца получателя есть печать Mör

use anchor_lang::{prelude::*, solana_program::program_option::COption};
use spl_discriminator::SplDiscriminate;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_token_2022_interface::{
    extension::{transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions},
    state::{Account as TokenAccount, Mint},
};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("2A8chB6zt4LCsiiks5NrY3DceHvAVqWkAmMdNpyFkhz2");

pub const TOKEN_2022_ID: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
/// Из того же крейта, что берут сторонние потребители
pub use mor_verify_seal::{MOR_REGISTRY_ID, SEAL_SEED};
use mor_verify_seal::{verify_seal, TrustLevel};
pub const POLICY_SEED: &[u8] = b"policy";
/// Задан интерфейсом transfer hook
pub const EXTRA_METAS_SEED: &[u8] = b"extra-account-metas";
/// Extra-аккаунты `execute`: реестр (5), политика (6), печать получателя (7)
pub const EXTRA_METAS_LEN: usize = 3;

#[program]
pub mod sealed_transfer {
    use super::*;

    /// Создаёт политику и extra-account-metas, подписывает mint authority
    pub fn initialize(ctx: Context<InitializeHook>, min_trust_level: u8) -> Result<()> {
        require!(TrustLevel::from_u8(min_trust_level).is_some(), HookError::BadTrustLevel);
        {
            let data = ctx.accounts.mint.try_borrow_data()?;
            let mint = StateWithExtensions::<Mint>::unpack(&data[..])?;
            require!(
                mint.base.mint_authority == COption::Some(ctx.accounts.authority.key()),
                HookError::NotMintAuthority
            );
        }

        let metas = [
            ExtraAccountMeta::new_with_pubkey(&MOR_REGISTRY_ID, false, false)?,
            ExtraAccountMeta::new_with_seeds(
                &[Seed::Literal { bytes: POLICY_SEED.to_vec() }, Seed::AccountKey { index: 1 }],
                false,
                false,
            )?,
            // PDA реестра (аккаунт 5) из "seal" и owner получателя: байты 32..64 аккаунта 2
            ExtraAccountMeta::new_external_pda_with_seeds(
                5,
                &[
                    Seed::Literal { bytes: SEAL_SEED.to_vec() },
                    Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
                ],
                false,
                false,
            )?,
        ];
        {
            let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
            ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data[..], &metas)?;
        }

        let policy = &mut ctx.accounts.policy;
        policy.mint = ctx.accounts.mint.key();
        policy.min_trust_level = min_trust_level;
        policy.bump = ctx.bumps.policy;
        Ok(())
    }

    /// Token-2022 вызывает это на каждый transfer_checked минта
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn execute(ctx: Context<Execute>, _amount: u64) -> Result<()> {
        // Прямой вызов хука мимо Token-2022 ничего не должен разрешать
        {
            let data = ctx.accounts.source.try_borrow_data()?;
            let source = StateWithExtensions::<TokenAccount>::unpack(&data[..])?;
            require!(
                bool::from(source.get_extension::<TransferHookAccount>()?.transferring),
                HookError::NotTransferring
            );
        }
        let owner = {
            let data = ctx.accounts.destination.try_borrow_data()?;
            StateWithExtensions::<TokenAccount>::unpack(&data[..])?.base.owner
        };
        let min = TrustLevel::from_u8(ctx.accounts.policy.min_trust_level).ok_or(HookError::BadTrustLevel)?;
        verify_seal(&ctx.accounts.seal, &owner, min)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeHook<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: минт Token-2022; mint authority проверяется в обработчике
    #[account(owner = TOKEN_2022_ID)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: создаётся здесь, раскладку пишет ExtraAccountMetaList
    #[account(
        init,
        payer = authority,
        space = ExtraAccountMetaList::size_of(EXTRA_METAS_LEN).unwrap(),
        seeds = [EXTRA_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Policy::INIT_SPACE,
        seeds = [POLICY_SEED, mint.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, Policy>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: флаг transferring проверяется в обработчике
    #[account(owner = TOKEN_2022_ID)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: минт перевода
    pub mint: UncheckedAccount<'info>,
    /// CHECK: owner (байты 32..64) идёт в сиды печати
    #[account(owner = TOKEN_2022_ID)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: authority перевода, хуку не нужна
    pub authority: UncheckedAccount<'info>,
    /// CHECK: extra-account-metas этого минта, проверен сидами
    #[account(seeds = [EXTRA_METAS_SEED, mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    /// CHECK: нужен только ключ, для PDA печати
    #[account(address = MOR_REGISTRY_ID)]
    pub mor_registry: UncheckedAccount<'info>,
    #[account(
        seeds = [POLICY_SEED, mint.key().as_ref()],
        bump = policy.bump,
        has_one = mint @ HookError::PolicyMismatch
    )]
    pub policy: Account<'info, Policy>,
    /// CHECK: проверяет mor-verify-seal
    pub seal: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub mint: Pubkey,
    /// 0: Attestor, 1: Trustless, как `TrustLevel` реестра
    pub min_trust_level: u8,
    pub bump: u8,
}

#[error_code]
pub enum HookError {
    #[msg("Hook called outside of a Token-2022 transfer")]
    NotTransferring,
    #[msg("Policy does not belong to this mint")]
    PolicyMismatch,
    #[msg("Signer is not the mint authority")]
    NotMintAuthority,
    #[msg("Unknown trust level")]
    BadTrustLevel,
}
