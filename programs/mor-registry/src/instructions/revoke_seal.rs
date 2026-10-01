use anchor_lang::prelude::*;

use crate::{controller, error::MorError, state::Seal};

/// Отзыв печати. Может сохранённый контролёр (дал согласие при печати) или текущий: после
/// продажи программы или смены mint authority новый владелец снимает печать прежней организации.
/// Сохранённый нужен, когда текущего нет вовсе (mint authority = None, immutable-программа).
#[derive(Accounts)]
pub struct RevokeSeal<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: запечатанный адрес; совпадение с печатью — ограничение `seal`
    pub address: UncheckedAccount<'info>,
    /// CHECK: ProgramData для печати программы; проверяется в controller::controls
    pub program_data: Option<UncheckedAccount<'info>>,
    #[account(
        mut,
        close = signer,
        constraint = seal.address == address.key() @ MorError::NotController
    )]
    pub seal: Account<'info, Seal>,
}

pub fn handle_revoke_seal(ctx: Context<RevokeSeal>) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let seal = &ctx.accounts.seal;
    let address = ctx.accounts.address.to_account_info();
    let program_data = ctx.accounts.program_data.as_ref().map(|a| a.to_account_info());
    let stored = seal.controller == signer;
    let current = controller::controls(seal.address_kind, &address, program_data.as_ref(), &signer);
    require!(stored || current, MorError::NotController);
    Ok(())
}
