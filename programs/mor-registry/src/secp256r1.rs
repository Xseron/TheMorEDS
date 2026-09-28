//! Разбор данных инструкции прекомпайла secp256r1 (SIMD-0075).
//!
//! Раскладка: `num_signatures: u8`, `padding: u8`, затем `num_signatures` структур
//! смещений по 14 байт (7 × u16 LE: signature_offset, signature_instruction_index,
//! public_key_offset, public_key_instruction_index, message_offset, message_length,
//! message_instruction_index), затем произвольные данные. Индекс `0xFFFF` означает
//! «эта же инструкция».
//!
//! Программа принимает только самодостаточную инструкцию с одной подписью и читает
//! ключ и сообщение ровно по тем смещениям, по которым их проверил прекомпайл.
//! Так нельзя подменить проверенные байты на другие.

use anchor_lang::prelude::*;

use crate::error::MorError;

pub const HEADER_LEN: usize = 2;
pub const OFFSETS_LEN: usize = 14;
pub const PUBKEY_LEN: usize = 33;
pub const SIGNATURE_LEN: usize = 64;
pub const SELF_INDEX: u16 = 0xFFFF;

#[derive(Debug)]
pub struct VerifiedSignature<'a> {
    pub pubkey: &'a [u8],
    pub signature: &'a [u8],
    pub message: &'a [u8],
}

pub fn parse_self_contained(data: &[u8]) -> Result<VerifiedSignature<'_>> {
    require!(data.len() >= HEADER_LEN + OFFSETS_LEN, MorError::PrecompileMalformed);
    require!(data[0] == 1, MorError::PrecompileMalformed);

    let field = |i: usize| u16::from_le_bytes([data[HEADER_LEN + 2 * i], data[HEADER_LEN + 2 * i + 1]]);
    let (sig_off, sig_ix) = (field(0), field(1));
    let (pk_off, pk_ix) = (field(2), field(3));
    let (msg_off, msg_len, msg_ix) = (field(4), field(5), field(6));
    require!(
        sig_ix == SELF_INDEX && pk_ix == SELF_INDEX && msg_ix == SELF_INDEX,
        MorError::PrecompileMalformed
    );

    let slice = |off: u16, len: usize| -> Result<&[u8]> {
        let start = off as usize;
        let end = start.checked_add(len).ok_or(MorError::PrecompileMalformed)?;
        data.get(start..end).ok_or_else(|| error!(MorError::PrecompileMalformed))
    };

    Ok(VerifiedSignature {
        pubkey: slice(pk_off, PUBKEY_LEN)?,
        signature: slice(sig_off, SIGNATURE_LEN)?,
        message: slice(msg_off, msg_len as usize)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::error::Error;

    fn code(e: Error) -> u32 {
        match e {
            Error::AnchorError(a) => a.error_code_number,
            other => panic!("unexpected error {other:?}"),
        }
    }

    /// [num][pad][7 × u16 LE][payload]
    fn data(num: u8, offsets: [u16; 7], payload: &[u8]) -> Vec<u8> {
        let mut d = vec![num, 0];
        for v in offsets {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(payload);
        d
    }

    fn payload(msg: &[u8]) -> Vec<u8> {
        let mut p = vec![0x02u8; 33];
        p.extend(vec![0x11u8; 64]);
        p.extend_from_slice(msg);
        p
    }

    // pubkey @16, sig @49, msg @113
    const OK: [u16; 7] = [49, 0xFFFF, 16, 0xFFFF, 113, 5, 0xFFFF];

    #[test]
    fn parses_self_contained_instruction() {
        let d = data(1, OK, &payload(b"hello"));
        let v = parse_self_contained(&d).unwrap();
        assert_eq!(v.pubkey, &[0x02u8; 33]);
        assert_eq!(v.signature, &[0x11u8; 64]);
        assert_eq!(v.message, b"hello");
    }

    #[test]
    fn rejects_multiple_signatures() {
        let d = data(2, OK, &payload(b"hello"));
        assert_eq!(code(parse_self_contained(&d).unwrap_err()), u32::from(MorError::PrecompileMalformed));
    }

    #[test]
    fn rejects_zero_signatures() {
        let d = data(0, OK, &payload(b"hello"));
        assert_eq!(code(parse_self_contained(&d).unwrap_err()), u32::from(MorError::PrecompileMalformed));
    }

    #[test]
    fn rejects_non_self_indexes() {
        for i in [1usize, 3, 6] {
            let mut off = OK;
            off[i] = 0; // ссылка на инструкцию 0, а не на себя
            let d = data(1, off, &payload(b"hello"));
            assert_eq!(code(parse_self_contained(&d).unwrap_err()), u32::from(MorError::PrecompileMalformed), "index field {i}");
        }
    }

    #[test]
    fn rejects_out_of_bounds_message() {
        let mut off = OK;
        off[5] = 6; // сообщение длиннее данных на байт
        let d = data(1, off, &payload(b"hello"));
        assert_eq!(code(parse_self_contained(&d).unwrap_err()), u32::from(MorError::PrecompileMalformed));
    }

    #[test]
    fn rejects_offset_overflow() {
        let off = [49, 0xFFFF, 16, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF];
        let d = data(1, off, &payload(b"hello"));
        assert_eq!(code(parse_self_contained(&d).unwrap_err()), u32::from(MorError::PrecompileMalformed));
    }

    #[test]
    fn rejects_short_data() {
        assert_eq!(code(parse_self_contained(&[1, 0, 0]).unwrap_err()), u32::from(MorError::PrecompileMalformed));
        assert_eq!(code(parse_self_contained(&[]).unwrap_err()), u32::from(MorError::PrecompileMalformed));
    }
}
