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
}
