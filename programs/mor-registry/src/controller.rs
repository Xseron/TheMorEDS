//! Кто сейчас контролирует адрес: без его подписи печать не создаётся, а текущий контролёр
//! может снять печать, выданную при прежнем владельце.

use anchor_lang::{
    prelude::*,
    solana_program::{bpf_loader_upgradeable, system_program},
};

use crate::{
    constants::{TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID},
    state::AddressKind,
};

/// bincode `UpgradeableLoaderState`: тег u32 LE; Program = 2 (+ адрес ProgramData),
/// ProgramData = 3 (+ u64 slot + Option<Pubkey> upgrade authority: байт 12 — Some, 13..45 — ключ).
const LOADER_PROGRAM_TAG: [u8; 4] = [2, 0, 0, 0];
const LOADER_PROGRAM_DATA_TAG: [u8; 4] = [3, 0, 0, 0];
/// Минт SPL Token / Token-2022: COption<Pubkey> mint_authority (0..36), supply, decimals,
/// is_initialized (45), freeze_authority — первые 82 байта у обеих программ.
const MINT_BASE_LEN: usize = 82;
const MINT_IS_INITIALIZED: usize = 45;
/// У Token-2022 с расширениями байт 165 — тип аккаунта: 1 — минт, 2 — токен-аккаунт.
const TOKEN_2022_ACCOUNT_TYPE: usize = 165;

pub fn controls(kind: AddressKind, address: &AccountInfo, program_data: Option<&AccountInfo>, controller: &Pubkey) -> bool {
    match kind {
        // Кошелёк — адрес под System Program; у программы и минта свои контролёры.
        AddressKind::Wallet => address.key == controller && address.owner == &system_program::ID,
        AddressKind::Program => program_data.is_some_and(|pd| upgrade_authority_is(address, pd, controller)),
        AddressKind::Mint => mint_authority_is(address, controller),
    }
}

fn upgrade_authority_is(program: &AccountInfo, program_data: &AccountInfo, controller: &Pubkey) -> bool {
    if program.owner != &bpf_loader_upgradeable::ID || program_data.owner != &bpf_loader_upgradeable::ID {
        return false;
    }
    let (Ok(p), Ok(pd)) = (program.try_borrow_data(), program_data.try_borrow_data()) else {
        return false;
    };
    p.len() >= 36
        && p[..4] == LOADER_PROGRAM_TAG
        && p[4..36] == program_data.key.as_ref()[..]
        && pd.len() >= 45
        && pd[..4] == LOADER_PROGRAM_DATA_TAG
        && pd[12] == 1
        && pd[13..45] == controller.as_ref()[..]
}

fn mint_authority_is(mint: &AccountInfo, controller: &Pubkey) -> bool {
    let token_2022 = mint.owner == &TOKEN_2022_PROGRAM_ID;
    if mint.owner != &TOKEN_PROGRAM_ID && !token_2022 {
        return false;
    }
    let Ok(d) = mint.try_borrow_data() else {
        return false;
    };
    // Токен-аккаунт (165 байт) не должен сойти за минт.
    let mint_layout = d.len() == MINT_BASE_LEN
        || (token_2022 && d.len() > TOKEN_2022_ACCOUNT_TYPE && d[TOKEN_2022_ACCOUNT_TYPE] == 1);
    mint_layout && d[..4] == [1, 0, 0, 0] && d[4..36] == controller.as_ref()[..] && d[MINT_IS_INITIALIZED] == 1
}
