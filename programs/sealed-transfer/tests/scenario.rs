use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::{AccountMeta, Instruction},
            system_instruction, system_program,
        },
        InstructionData, ToAccountMetas,
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    mor_verify_seal::{test_utils::seal_account, TrustLevel},
    sealed_transfer::{EXTRA_METAS_SEED, MOR_REGISTRY_ID, POLICY_SEED, SEAL_SEED, TOKEN_2022_ID},
    solana_account::Account,
    solana_instruction::error::InstructionError,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
    spl_token_2022_interface::{
        extension::{transfer_hook, ExtensionType},
        instruction as token_ix,
        state::{Account as TokenAccount, Mint},
    },
};

type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

const DECIMALS: u8 = 0;

fn program_bytes() -> Vec<u8> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/sealed_transfer.so");
    std::fs::read(path).unwrap_or_else(|e| panic!("run `anchor build` first: {path}: {e}"))
}

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ixs: &[Instruction]) -> TxResult {
    // Свежий blockhash: иначе LiteSVM отклонит повтор той же транзакции как AlreadyProcessed
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let mut all = vec![payer];
    all.extend_from_slice(signers);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
    svm.send_transaction(tx)
}

fn ok(res: TxResult) -> TransactionMetadata {
    res.unwrap_or_else(|e| panic!("{:?}\n{:#?}", e.err, e.meta.logs))
}

/// Ошибка хука доходит через CPI до инструкции 0 как есть
fn custom_code(res: &TxResult) -> Option<u32> {
    match res {
        Err(e) => match &e.err {
            TransactionError::InstructionError(0, InstructionError::Custom(code)) => Some(*code),
            _ => None,
        },
        Ok(_) => None,
    }
}

fn seal_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SEAL_SEED, owner.as_ref()], &MOR_REGISTRY_ID).0
}

struct Env {
    svm: LiteSVM,
    issuer: Keypair,
    mint: Pubkey,
}

impl Env {
    /// Минт с TransferHook на sealed-transfer
    fn new(min_trust_level: u8) -> Env {
        let mut svm = LiteSVM::new();
        svm.add_program(sealed_transfer::ID, &program_bytes()).unwrap();
        let issuer = Keypair::new();
        svm.airdrop(&issuer.pubkey(), 10_000_000_000).unwrap();

        let mint = Keypair::new();
        let space = ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::TransferHook]).unwrap();
        let rent = svm.minimum_balance_for_rent_exemption(space);
        let ixs = [
            system_instruction::create_account(&issuer.pubkey(), &mint.pubkey(), rent, space as u64, &TOKEN_2022_ID),
            transfer_hook::instruction::initialize(
                &TOKEN_2022_ID,
                &mint.pubkey(),
                Some(issuer.pubkey()),
                Some(sealed_transfer::ID),
            )
            .unwrap(),
            token_ix::initialize_mint2(&TOKEN_2022_ID, &mint.pubkey(), &issuer.pubkey(), None, DECIMALS).unwrap(),
        ];
        ok(send(&mut svm, &issuer, &[&mint], &ixs));

        let mut env = Env { svm, issuer, mint: mint.pubkey() };
        let init = Instruction::new_with_bytes(
            sealed_transfer::ID,
            &sealed_transfer::instruction::Initialize { min_trust_level }.data(),
            sealed_transfer::accounts::InitializeHook {
                authority: env.issuer.pubkey(),
                mint: env.mint,
                extra_account_meta_list: env.extra_metas(),
                policy: env.policy(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        let issuer = env.issuer.insecure_clone();
        ok(send(&mut env.svm, &issuer, &[], &[init]));
        env
    }

    fn extra_metas(&self) -> Pubkey {
        Pubkey::find_program_address(&[EXTRA_METAS_SEED, self.mint.as_ref()], &sealed_transfer::ID).0
    }

    fn policy(&self) -> Pubkey {
        Pubkey::find_program_address(&[POLICY_SEED, self.mint.as_ref()], &sealed_transfer::ID).0
    }

    fn set_clock(&mut self, unix_timestamp: i64) {
        self.svm.set_sysvar(&Clock { unix_timestamp, ..Clock::default() });
    }

    /// TransferHookAccount нужен хуку ради флага transferring
    fn token_account(&mut self, owner: &Pubkey) -> Pubkey {
        let account = Keypair::new();
        let space =
            ExtensionType::try_calculate_account_len::<TokenAccount>(&[ExtensionType::TransferHookAccount]).unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(space);
        let issuer = self.issuer.insecure_clone();
        let ixs = [
            system_instruction::create_account(&issuer.pubkey(), &account.pubkey(), rent, space as u64, &TOKEN_2022_ID),
            token_ix::initialize_account3(&TOKEN_2022_ID, &account.pubkey(), &self.mint, owner).unwrap(),
        ];
        ok(send(&mut self.svm, &issuer, &[&account], &ixs));
        account.pubkey()
    }

    fn mint_to(&mut self, account: &Pubkey, amount: u64) {
        let issuer = self.issuer.insecure_clone();
        let ix = token_ix::mint_to(&TOKEN_2022_ID, &self.mint, account, &issuer.pubkey(), &[], amount).unwrap();
        ok(send(&mut self.svm, &issuer, &[], &[ix]));
    }

    /// Аккаунты хука идут следом, Token-2022 находит их по ключам
    fn transfer(&mut self, owner: &Keypair, from: &Pubkey, to: &Pubkey, to_owner: &Pubkey, amount: u64) -> TxResult {
        let mut ix =
            token_ix::transfer_checked(&TOKEN_2022_ID, from, &self.mint, to, &owner.pubkey(), &[], amount, DECIMALS)
                .unwrap();
        for key in [MOR_REGISTRY_ID, self.policy(), seal_pda(to_owner), sealed_transfer::ID, self.extra_metas()] {
            ix.accounts.push(AccountMeta::new_readonly(key, false));
        }
        send(&mut self.svm, owner, &[], &[ix])
    }
}

const NOW: i64 = 1_800_000_000;

/// Пишем аккаунт печати напрямую: регистрацию проверяют тесты реестра
fn put_seal(env: &mut Env, owner: &Pubkey, level: TrustLevel, expires_at: i64) {
    let (pda, data) = seal_account(owner, level, expires_at);
    let account = Account { lamports: 10_000_000, data, owner: MOR_REGISTRY_ID, executable: false, rent_epoch: 0 };
    env.svm.set_account(pda, account).unwrap();
}

/// Отзыв закрывает аккаунт печати: ни лампортов, ни данных
fn remove_seal(env: &mut Env, owner: &Pubkey) {
    let account = Account { lamports: 0, data: vec![], owner: system_program::ID, executable: false, rent_epoch: 0 };
    env.svm.set_account(seal_pda(owner), account).unwrap();
}

#[test]
fn only_sealed_recipients_receive() {
    let mut env = Env::new(TrustLevel::Attestor as u8);
    env.set_clock(NOW);
    let alice = Keypair::new();
    env.svm.airdrop(&alice.pubkey(), 1_000_000_000).unwrap();
    let from = env.token_account(&alice.pubkey());
    env.mint_to(&from, 100);

    let sealed = Pubkey::new_unique();
    let unsealed = Pubkey::new_unique();
    let to_sealed = env.token_account(&sealed);
    let to_unsealed = env.token_account(&unsealed);
    put_seal(&mut env, &sealed, TrustLevel::Attestor, NOW + 3_600);

    ok(env.transfer(&alice, &from, &to_sealed, &sealed, 10));
    assert_eq!(custom_code(&env.transfer(&alice, &from, &to_unsealed, &unsealed, 10)), Some(9100), "no seal");

    env.set_clock(NOW + 3_600);
    assert_eq!(custom_code(&env.transfer(&alice, &from, &to_sealed, &sealed, 10)), Some(9102), "seal expired");
    env.set_clock(NOW);

    remove_seal(&mut env, &sealed);
    assert_eq!(custom_code(&env.transfer(&alice, &from, &to_sealed, &sealed, 10)), Some(9100), "seal revoked");
}
