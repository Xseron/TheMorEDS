#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        pubkey,
        solana_program::{bpf_loader_upgradeable, instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    mor_registry::{error::MorError, state::TrustKind, x509},
    p256::{
        ecdsa::Signature,
        elliptic_curve::{ops::Reduce, PrimeField},
        Scalar, U256,
    },
    sha2::{Digest, Sha256},
    solana_instruction::error::InstructionError,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_transaction_error::TransactionError,
};

pub const SECP256R1_PROGRAM_ID: Pubkey = pubkey!("Secp256r1SigVerify1111111111111111111111111");

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub const CA1: &[u8] = include_bytes!("../../../../fixtures/ca1.der");
pub const CA1B: &[u8] = include_bytes!("../../../../fixtures/ca1b.der");
pub const CA2: &[u8] = include_bytes!("../../../../fixtures/ca2.der");
pub const EE_SMALL: &[u8] = include_bytes!("../../../../fixtures/ee_small.der");
pub const EE_LARGE: &[u8] = include_bytes!("../../../../fixtures/ee_large.der");
pub const EE_OTHER_CA: &[u8] = include_bytes!("../../../../fixtures/ee_other_ca.der");
pub const EE_WRONG_ISSUER: &[u8] = include_bytes!("../../../../fixtures/ee_wrong_issuer.der");
pub const EE_RSA: &[u8] = include_bytes!("../../../../fixtures/ee_rsa.der");
pub const EE_NO_ORGID: &[u8] = include_bytes!("../../../../fixtures/ee_no_orgid.der");
pub const EE_PERSON: &[u8] = include_bytes!("../../../../fixtures/ee_person.der");
pub const EE_OCSP: &[u8] = include_bytes!("../../../../fixtures/ee_ocsp.der");

/// (notBefore, notAfter) сертификата в unix-секундах.
pub fn validity(der: &[u8]) -> (i64, i64) {
    let (tbs, _) = x509::split_certificate(der).unwrap();
    let info = x509::parse_tbs(tbs).unwrap();
    (info.not_before, info.not_after)
}

/// Часы тестов: notBefore `ee_small` + 3 дня. Фикстуры выпускаются в момент запуска
/// `fixtures/gen.sh` на 10 лет, поэтому момент берётся из них, а не задаётся датой.
pub fn now() -> i64 {
    validity(EE_SMALL).0 + 3 * 86_400
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// 0x04‖X‖Y → (0x02 | (Y & 1))‖X.
pub fn compress_p256(uncompressed: &[u8]) -> [u8; 33] {
    assert_eq!(uncompressed.len(), 65);
    assert_eq!(uncompressed[0], 0x04);
    let mut out = [0u8; 33];
    out[0] = 0x02 | (uncompressed[64] & 1);
    out[1..].copy_from_slice(&uncompressed[1..33]);
    out
}

pub struct CaFixture {
    pub der: &'static [u8],
    pub pubkey: [u8; 33],
    pub spki_hash: [u8; 32],
    pub dn_hash: [u8; 32],
    pub name: &'static str,
    pub country: [u8; 2],
}

fn ca_fixture(der: &'static [u8], name: &'static str, country: [u8; 2]) -> CaFixture {
    let (tbs, _) = x509::split_certificate(der).unwrap();
    let info = x509::parse_tbs(tbs).unwrap();
    CaFixture {
        der,
        pubkey: compress_p256(info.public_key),
        spki_hash: sha256(info.spki),
        dn_hash: sha256(info.subject),
        name,
        country,
    }
}

pub fn ca1() -> CaFixture {
    ca_fixture(CA1, "Mor Test QTSP", *b"EE")
}

pub fn ca2() -> CaFixture {
    ca_fixture(CA2, "Other QTSP", *b"LT")
}

fn program_bytes() -> Vec<u8> {
    let path = std::env::var("MOR_SO")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/mor_registry.so").to_string());
    std::fs::read(&path).unwrap_or_else(|e| panic!("run `anchor build` first: {path}: {e}"))
}

/// LiteSVM создаёт ProgramData с upgrade_authority_address = None.
/// bincode-раскладка: [u32 tag = 3][u64 slot][u8 Some = 1][32 байта pubkey].
fn set_upgrade_authority(svm: &mut LiteSVM, program_id: &Pubkey, authority: &Pubkey) {
    let (programdata, _) =
        Pubkey::find_program_address(&[program_id.as_ref()], &bpf_loader_upgradeable::ID);
    let mut acc = svm.get_account(&programdata).expect("ProgramData exists");
    acc.data[12] = 1;
    acc.data[13..45].copy_from_slice(authority.as_ref());
    svm.set_account(programdata, acc).unwrap();
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub payer: Keypair,
    pub program_id: Pubkey,
}

impl Env {
    pub fn new() -> Env {
        let program_id = mor_registry::id();
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, &program_bytes()).unwrap();
        let admin = Keypair::new();
        let payer = Keypair::new();
        set_upgrade_authority(&mut svm, &program_id, &admin.pubkey());
        svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        let mut env = Env { svm, admin, payer, program_id };
        env.set_clock(now());
        env
    }

    pub fn set_clock(&mut self, unix_timestamp: i64) {
        self.svm.set_sysvar(&Clock {
            slot: 100,
            epoch_start_timestamp: unix_timestamp,
            epoch: 0,
            leader_schedule_epoch: 0,
            unix_timestamp,
        });
    }

    pub fn fund_new(&mut self) -> Keypair {
        let kp = Keypair::new();
        self.svm.airdrop(&kp.pubkey(), 10_000_000_000).unwrap();
        kp
    }

    pub fn config_pda(&self) -> Pubkey {
        Pubkey::find_program_address(&[mor_registry::CONFIG_SEED], &self.program_id).0
    }

    pub fn trust_pda(&self, spki_hash: &[u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[mor_registry::TRUST_SEED, spki_hash.as_slice()], &self.program_id).0
    }

    pub fn cert_pda(&self, trust: &Pubkey, serial: &[u8]) -> Pubkey {
        Pubkey::find_program_address(&[mor_registry::CERT_SEED, trust.as_ref(), serial], &self.program_id).0
    }

    pub fn send(&mut self, payer: &Keypair, signers: &[&Keypair], ixs: &[Instruction]) -> TxResult {
        send(&mut self.svm, payer, signers, ixs)
    }

    pub fn initialize_as(&mut self, signer: &Keypair) -> TxResult {
        let (program_data, _) =
            Pubkey::find_program_address(&[self.program_id.as_ref()], &bpf_loader_upgradeable::ID);
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &mor_registry::instruction::Initialize {}.data(),
            mor_registry::accounts::Initialize {
                admin: signer.pubkey(),
                config: self.config_pda(),
                program: self.program_id,
                program_data,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(signer, &[], &[ix])
    }

    pub fn initialize(&mut self) -> TxResult {
        let admin = self.admin.insecure_clone();
        self.initialize_as(&admin)
    }

    pub fn add_trust_service_as(&mut self, signer: &Keypair, kind: TrustKind, ca: &CaFixture) -> TxResult {
        let ix = Instruction::new_with_bytes(
            self.program_id,
            &mor_registry::instruction::AddTrustService {
                kind,
                pubkey: ca.pubkey,
                spki_hash: ca.spki_hash,
                subject_dn_hash: ca.dn_hash,
                name: ca.name.to_string(),
                country: ca.country,
            }
            .data(),
            mor_registry::accounts::AddTrustService {
                admin: signer.pubkey(),
                config: self.config_pda(),
                trust_service: self.trust_pda(&ca.spki_hash),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(signer, &[], &[ix])
    }

    /// Регистрирует УЦ от админа, возвращает адрес TrustService.
    pub fn add_trust_service(&mut self, ca: &CaFixture) -> Pubkey {
        let admin = self.admin.insecure_clone();
        self.add_trust_service_as(&admin, TrustKind::P256Ca, ca)
            .unwrap_or_else(|e| panic!("add_trust_service failed: {:?}\n{:#?}", e.err, e.meta.logs));
        self.trust_pda(&ca.spki_hash)
    }

    pub fn account<T: AccountDeserialize>(&self, key: &Pubkey) -> T {
        let acc = self.svm.get_account(key).unwrap_or_else(|| panic!("account {key} missing"));
        T::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }
}

/// Layout SIMD-0075: [num_signatures u8][padding u8][7 x u16 LE][data].
pub fn secp256r1_ix_raw(num_sigs: u8, offsets: [u16; 7], payload: &[u8]) -> Instruction {
    let mut data = Vec::with_capacity(16 + payload.len());
    data.push(num_sigs);
    data.push(0);
    for v in offsets {
        data.extend_from_slice(&v.to_le_bytes());
    }
    data.extend_from_slice(payload);
    Instruction::new_with_bytes(SECP256R1_PROGRAM_ID, &data, vec![])
}

/// Self-contained instruction: pubkey, signature and message all live in it,
/// every instruction_index == 0xFFFF. Data starts at offset 16.
pub fn secp256r1_ix(pubkey: &[u8; 33], sig: &[u8; 64], msg: &[u8]) -> Instruction {
    let pk_off: u16 = 16;
    let sig_off: u16 = pk_off + 33;
    let msg_off: u16 = sig_off + 64;
    let mut payload = Vec::with_capacity(33 + 64 + msg.len());
    payload.extend_from_slice(pubkey);
    payload.extend_from_slice(sig);
    payload.extend_from_slice(msg);
    secp256r1_ix_raw(
        1,
        [sig_off, 0xFFFF, pk_off, 0xFFFF, msg_off, msg.len() as u16, 0xFFFF],
        &payload,
    )
}

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    // Ruling R2: force a fresh blockhash so every transaction is unique,
    // otherwise LiteSVM rejects a byte-identical repeat with AlreadyProcessed
    // before the program/precompile ever runs.
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let mut all: Vec<&Keypair> = vec![payer];
    all.extend_from_slice(signers);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &all).unwrap();
    svm.send_transaction(tx)
}

/// (failed instruction index, Custom code) — for Anchor errors code = 6000 + variant number.
pub fn failed_ix(err: &FailedTransactionMetadata) -> Option<(u8, u32)> {
    match &err.err {
        TransactionError::InstructionError(ix, InstructionError::Custom(code)) => Some((*ix, *code)),
        _ => None,
    }
}

/// Anchor-ошибка `expected` в инструкции `ix_index` (коды 6000 + номер варианта).
pub fn assert_mor_err(res: &TxResult, expected: MorError, ix_index: u8) {
    let want = u32::from(expected);
    match res {
        Ok(_) => panic!("expected {expected:?}, transaction succeeded"),
        Err(e) => match failed_ix(e) {
            Some((ix, code)) if ix == ix_index && code == want => {}
            other => panic!("expected {expected:?} ({want}) at ix {ix_index}, got {other:?}; err={:?}\nlogs={:#?}", e.err, e.meta.logs),
        },
    }
}

/// s -> n - s: the signature stays mathematically valid but becomes high-S.
pub fn high_s(sig: &[u8; 64]) -> [u8; 64] {
    let s = Scalar::reduce(U256::from_be_slice(&sig[32..]));
    let neg = -s;
    let mut out = *sig;
    out[32..].copy_from_slice(&neg.to_repr());
    out
}

pub struct EeFixture {
    pub der: &'static [u8],
    pub tbs: &'static [u8],
    /// r‖s big-endian, low-S.
    pub sig: [u8; 64],
    pub serial: Vec<u8>,
    pub subject_key: [u8; 33],
}

pub fn ee(der: &'static [u8]) -> EeFixture {
    let (tbs, sig_der) = x509::split_certificate(der).unwrap();
    let sig = Signature::from_der(sig_der).unwrap();
    let sig = sig.normalize_s().unwrap_or(sig);
    let info = x509::parse_tbs(tbs).unwrap();
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&sig.to_bytes());
    EeFixture {
        der,
        tbs,
        sig: sig_bytes,
        serial: info.serial.to_vec(),
        // Non-P256 subject keys (e.g. RSA fixtures used for UnsupportedKey tests) aren't a
        // 65-byte uncompressed point; compress_p256 would panic, so fall back to a zeroed
        // placeholder. subject_key is only asserted on for certificates that register successfully.
        subject_key: if info.public_key.len() == 65 && info.public_key[0] == 0x04 {
            compress_p256(info.public_key)
        } else {
            [0u8; 33]
        },
    }
}

pub fn tx_size(env: &Env, payer: &Keypair, ixs: &[Instruction]) -> usize {
    let blockhash = env.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();
    bincode::serialize(&tx).unwrap().len()
}

impl Env {
    pub fn register_ix(&self, trust: &Pubkey, payer: &Pubkey, serial_arg: &[u8]) -> Instruction {
        Instruction::new_with_bytes(
            self.program_id,
            &mor_registry::instruction::RegisterCertificate { serial: serial_arg.to_vec() }.data(),
            mor_registry::accounts::RegisterCertificate {
                payer: *payer,
                trust_service: *trust,
                certificate: self.cert_pda(trust, serial_arg),
                instructions: solana_instructions_sysvar::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    pub fn register(&mut self, trust: &Pubkey, ca_pubkey: &[u8; 33], ee: &EeFixture) -> TxResult {
        let payer = self.payer.insecure_clone();
        let ixs = [
            secp256r1_ix(ca_pubkey, &ee.sig, ee.tbs),
            self.register_ix(trust, &payer.pubkey(), &ee.serial),
        ];
        self.send(&payer, &[], &ixs)
    }
}
