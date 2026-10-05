use anchor_lang::prelude::*;

use crate::{
    controller,
    error::MorError,
    state::{AddressKind, Seal},
};

/// Снять печать может сохранённый контролёр или текущий. Текущий нужен, чтобы после продажи
/// программы или смены mint authority новый владелец снял печать прежней организации, сохранённый
/// на случай, когда текущего нет вовсе: mint authority = None, immutable-программа
#[derive(Accounts)]
pub struct RevokeSeal<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: совпадение с печатью проверяет ограничение на `seal`
    pub address: UncheckedAccount<'info>,
    /// CHECK: проверяется в controller::controls
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
    // Вид адреса любой: запечатанный как кошелёк адрес мог потом стать минтом или программой
    let current = [AddressKind::Wallet, AddressKind::Program, AddressKind::Mint]
        .into_iter()
        .any(|kind| controller::controls(kind, &address, program_data.as_ref(), &signer));
    require!(stored || current, MorError::NotController);
    Ok(())
}
