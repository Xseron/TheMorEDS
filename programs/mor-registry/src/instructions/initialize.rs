use anchor_lang::prelude::*;

use crate::{constants::*, error::MorError, state::Config};

/// Создать Config. Разрешено только upgrade authority программы:
/// иначе первый встречный после деплоя стал бы админом.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ MorError::Unauthorized)]
    pub program: Program<'info, crate::program::MorRegistry>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ MorError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.bump = ctx.bumps.config;
    Ok(())
}
