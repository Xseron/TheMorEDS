//! Минимальный строгий DER-разбор X.509: только то, что нужно реестру.
//! Без внешних крейтов и аллокаций: все результаты — срезы входного буфера.

use crate::constants::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum X509Error {
    Malformed,
    FieldTooLong,
    BadTime,
}

type R<T> = Result<T, X509Error>;

const TAG_INTEGER: u8 = 0x02;
const TAG_BIT_STRING: u8 = 0x03;
const TAG_OID: u8 = 0x06;
const TAG_UTF8_STRING: u8 = 0x0c;
const TAG_PRINTABLE_STRING: u8 = 0x13;
const TAG_UTC_TIME: u8 = 0x17;
const TAG_GENERALIZED_TIME: u8 = 0x18;
const TAG_SEQUENCE: u8 = 0x30;
const TAG_SET: u8 = 0x31;
const TAG_VERSION: u8 = 0xa0; // [0] EXPLICIT

/// Один элемент DER: тег, содержимое и полные байты (для хэшей).
#[derive(Clone, Copy, Debug)]
pub struct Tlv<'a> {
    pub tag: u8,
    pub body: &'a [u8],
    pub raw: &'a [u8],
}

/// Читает TLV в начале `buf`; возвращает его и остаток буфера.
/// Только определённые длины не длиннее 4 байт в минимальной форме.
pub fn read_tlv(buf: &[u8]) -> R<(Tlv<'_>, &[u8])> {
    let tag = *buf.first().ok_or(X509Error::Malformed)?;
    let first = *buf.get(1).ok_or(X509Error::Malformed)?;
    let (len, header) = if first & 0x80 == 0 {
        (first as usize, 2)
    } else {
        let n = (first & 0x7f) as usize;
        if n == 0 || n > 4 {
            return Err(X509Error::Malformed);
        }
        let bytes = buf.get(2..2 + n).ok_or(X509Error::Malformed)?;
        if bytes[0] == 0 {
            return Err(X509Error::Malformed);
        }
        let len = bytes.iter().fold(0usize, |acc, b| (acc << 8) | *b as usize);
        if len < 0x80 {
            return Err(X509Error::Malformed);
        }
        (len, 2 + n)
    };
    let end = header.checked_add(len).ok_or(X509Error::Malformed)?;
    let raw = buf.get(..end).ok_or(X509Error::Malformed)?;
    Ok((Tlv { tag, body: &raw[header..], raw }, &buf[end..]))
}

fn expect(buf: &[u8], tag: u8) -> R<(Tlv<'_>, &[u8])> {
    let (tlv, rest) = read_tlv(buf)?;
    if tlv.tag != tag {
        return Err(X509Error::Malformed);
    }
    Ok((tlv, rest))
}

fn bit_string_bytes(tlv: Tlv<'_>) -> R<&[u8]> {
    let (unused, bytes) = tlv.body.split_first().ok_or(X509Error::Malformed)?;
    if *unused != 0 {
        return Err(X509Error::Malformed);
    }
    Ok(bytes)
}

/// Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue BIT STRING }.
/// Возвращает полный TLV TBS и байты подписи без байта unused bits.
pub fn split_certificate(der: &[u8]) -> R<(&[u8], &[u8])> {
    let (cert, rest) = expect(der, TAG_SEQUENCE)?;
    if !rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    let (tbs, rest) = expect(cert.body, TAG_SEQUENCE)?;
    let (_sig_alg, rest) = expect(rest, TAG_SEQUENCE)?;
    let (sig, rest) = expect(rest, TAG_BIT_STRING)?;
    if !rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    Ok((tbs.raw, bit_string_bytes(sig)?))
}

pub struct TbsInfo<'a> {
    /// Содержимое INTEGER как есть, вместе с ведущим нулём.
    pub serial: &'a [u8],
    pub sig_alg_oid: &'a [u8],
    /// Полный TLV Name издателя — для sha256.
    pub issuer: &'a [u8],
    pub not_before: i64,
    pub not_after: i64,
    /// Полный TLV Name субъекта.
    pub subject: &'a [u8],
    /// Полный TLV SubjectPublicKeyInfo — для сида TrustService.
    pub spki: &'a [u8],
    pub spki_alg_oid: &'a [u8],
    pub spki_params_oid: Option<&'a [u8]>,
    /// Содержимое BIT STRING ключа без байта unused bits (65 байт для P-256).
    pub public_key: &'a [u8],
    pub org_name: Option<&'a str>,
    pub org_id: Option<&'a str>,
    pub country: Option<[u8; 2]>,
    /// В subject есть surname, givenName или serialNumber.
    pub has_person_attrs: bool,
}

/// TBSCertificate ::= SEQUENCE { version [0] EXPLICIT OPTIONAL, serialNumber, signature,
/// issuer, validity, subject, subjectPublicKeyInfo, ... extensions }.
pub fn parse_tbs(tbs: &[u8]) -> R<TbsInfo<'_>> {
    let (seq, rest) = expect(tbs, TAG_SEQUENCE)?;
    if !rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    let mut cur = seq.body;
    if cur.first() == Some(&TAG_VERSION) {
        cur = read_tlv(cur)?.1;
    }
    let (serial, cur) = expect(cur, TAG_INTEGER)?;
    if serial.body.is_empty() {
        return Err(X509Error::Malformed);
    }
    let (sig_alg, cur) = expect(cur, TAG_SEQUENCE)?;
    let (sig_alg_oid, _) = expect(sig_alg.body, TAG_OID)?;
    let (issuer, cur) = expect(cur, TAG_SEQUENCE)?;
    let (validity, cur) = expect(cur, TAG_SEQUENCE)?;
    let (not_before, v_rest) = read_tlv(validity.body)?;
    let (not_after, v_rest) = read_tlv(v_rest)?;
    if !v_rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    let (subject, cur) = expect(cur, TAG_SEQUENCE)?;
    let (spki, _extensions) = expect(cur, TAG_SEQUENCE)?;

    let (alg, s_rest) = expect(spki.body, TAG_SEQUENCE)?;
    let (key_bits, s_rest) = expect(s_rest, TAG_BIT_STRING)?;
    if !s_rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    let (spki_alg_oid, a_rest) = expect(alg.body, TAG_OID)?;
    let spki_params_oid = match a_rest.first() {
        Some(&TAG_OID) => Some(read_tlv(a_rest)?.0.body),
        _ => None,
    };

    let attrs = parse_subject(subject.body)?;
    Ok(TbsInfo {
        serial: serial.body,
        sig_alg_oid: sig_alg_oid.body,
        issuer: issuer.raw,
        not_before: parse_time(not_before)?,
        not_after: parse_time(not_after)?,
        subject: subject.raw,
        spki: spki.raw,
        spki_alg_oid: spki_alg_oid.body,
        spki_params_oid,
        public_key: bit_string_bytes(key_bits)?,
        org_name: attrs.org_name,
        org_id: attrs.org_id,
        country: attrs.country,
        has_person_attrs: attrs.has_person_attrs,
    })
}

struct SubjectAttrs<'a> {
    org_name: Option<&'a str>,
    org_id: Option<&'a str>,
    country: Option<[u8; 2]>,
    has_person_attrs: bool,
}

/// Name ::= SEQUENCE OF RelativeDistinguishedName; RDN ::= SET OF AttributeTypeAndValue.
/// Принимает содержимое SEQUENCE (без внешнего тега).
fn parse_subject(mut body: &[u8]) -> R<SubjectAttrs<'_>> {
    let mut out = SubjectAttrs { org_name: None, org_id: None, country: None, has_person_attrs: false };
    while !body.is_empty() {
        let (rdn, rest) = expect(body, TAG_SET)?;
        body = rest;
        let mut inner = rdn.body;
        while !inner.is_empty() {
            let (atv, rest) = expect(inner, TAG_SEQUENCE)?;
            inner = rest;
            let (oid, v_rest) = expect(atv.body, TAG_OID)?;
            let (value, v_rest) = read_tlv(v_rest)?;
            if !v_rest.is_empty() {
                return Err(X509Error::Malformed);
            }
            let oid = oid.body;
            if oid == OID_O {
                out.org_name = Some(dir_string(value, MAX_ORG_NAME_LEN)?);
            } else if oid == OID_ORG_ID {
                out.org_id = Some(dir_string(value, MAX_ORG_ID_LEN)?);
            } else if oid == OID_C {
                let s = dir_string(value, 2)?.as_bytes();
                if s.len() != 2 {
                    return Err(X509Error::Malformed);
                }
                out.country = Some([s[0], s[1]]);
            } else if oid == OID_SURNAME || oid == OID_GIVEN_NAME || oid == OID_SERIAL_NUMBER {
                out.has_person_attrs = true;
            }
        }
    }
    Ok(out)
}

/// UTF8String или PrintableString с проверкой лимита. Другие типы строк не принимаем.
fn dir_string(value: Tlv<'_>, max_len: usize) -> R<&str> {
    if value.tag != TAG_UTF8_STRING && value.tag != TAG_PRINTABLE_STRING {
        return Err(X509Error::Malformed);
    }
    if value.body.len() > max_len {
        return Err(X509Error::FieldTooLong);
    }
    core::str::from_utf8(value.body).map_err(|_| X509Error::Malformed)
}

/// UTCTime `YYMMDDHHMMSSZ` (50–99 → 19xx, иначе 20xx) или GeneralizedTime `YYYYMMDDHHMMSSZ` → unix.
fn parse_time(t: Tlv<'_>) -> R<i64> {
    let b = t.body;
    let (year, rest) = match t.tag {
        TAG_UTC_TIME if b.len() == 13 => {
            let yy = digits(&b[..2])?;
            (if yy >= 50 { 1900 + yy } else { 2000 + yy }, &b[2..])
        }
        TAG_GENERALIZED_TIME if b.len() == 15 => (digits(&b[..4])?, &b[4..]),
        _ => return Err(X509Error::BadTime),
    };
    if rest[10] != b'Z' {
        return Err(X509Error::BadTime);
    }
    let (month, day) = (digits(&rest[0..2])?, digits(&rest[2..4])?);
    let (hour, minute, second) = (digits(&rest[4..6])?, digits(&rest[6..8])?, digits(&rest[8..10])?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return Err(X509Error::BadTime);
    }
    Ok(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

fn digits(d: &[u8]) -> R<i64> {
    d.iter().try_fold(0i64, |acc, c| {
        if c.is_ascii_digit() { Ok(acc * 10 + (c - b'0') as i64) } else { Err(X509Error::BadTime) }
    })
}

/// Дни от 1970-01-01 по григорианскому календарю (алгоритм Хиннанта).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::*;

    const EE_SMALL: &[u8] = include_bytes!("../../../fixtures/ee_small.der");
    const EE_PERSON: &[u8] = include_bytes!("../../../fixtures/ee_person.der");
    const EE_NO_ORGID: &[u8] = include_bytes!("../../../fixtures/ee_no_orgid.der");
    const EE_RSA: &[u8] = include_bytes!("../../../fixtures/ee_rsa.der");
    const EE_LARGE: &[u8] = include_bytes!("../../../fixtures/ee_large.der");
    const CA1: &[u8] = include_bytes!("../../../fixtures/ca1.der");

    fn tbs(der: &[u8]) -> TbsInfo<'_> {
        let (tbs, _) = split_certificate(der).unwrap();
        parse_tbs(tbs).unwrap()
    }

    #[test]
    fn splits_certificate_into_tbs_and_signature() {
        let (tbs, sig) = split_certificate(EE_SMALL).unwrap();
        assert_eq!(tbs[0], 0x30);
        assert!(tbs.len() > 300 && tbs.len() < EE_SMALL.len());
        assert_eq!(sig[0], 0x30, "ECDSA-Sig-Value is a SEQUENCE");
        assert!(sig.len() >= 68 && sig.len() <= 72);
    }

    #[test]
    fn parses_small_certificate_fields() {
        let t = tbs(EE_SMALL);
        assert!(!t.serial.is_empty() && t.serial.len() <= 20);
        assert_eq!(t.sig_alg_oid, OID_ECDSA_WITH_SHA256);
        assert_eq!(t.issuer[0], 0x30);
        assert_eq!(t.subject[0], 0x30);
        assert_eq!(t.spki[0], 0x30);
        assert_eq!(t.spki_alg_oid, OID_EC_PUBLIC_KEY);
        assert_eq!(t.spki_params_oid, Some(OID_PRIME256V1));
        assert_eq!(t.public_key.len(), 65);
        assert_eq!(t.public_key[0], 0x04);
        assert_eq!(t.org_name, Some("Acme Robotics"));
        assert_eq!(t.org_id, Some("NTREE-12345678"));
        assert_eq!(t.country, Some(*b"EE"));
        assert!(!t.has_person_attrs);
        assert!(t.not_before < t.not_after);
        assert!(t.not_before > 1_780_000_000, "issued in 2026 or later");
        assert!(t.not_after - t.not_before > 3649 * 86400);
    }

    #[test]
    fn parses_utf8_subject_of_large_certificate() {
        let t = tbs(EE_LARGE);
        assert_eq!(t.org_name, Some("Acme Robotics OÜ"));
        let (tbs_bytes, _) = split_certificate(EE_LARGE).unwrap();
        assert!(tbs_bytes.len() >= 1200, "large TBS is {} bytes", tbs_bytes.len());
    }

    #[test]
    fn detects_person_attributes() {
        assert!(tbs(EE_PERSON).has_person_attrs);
        assert_eq!(tbs(EE_PERSON).org_id, Some("NTREE-12345678"));
    }

    #[test]
    fn missing_org_id_is_none() {
        let t = tbs(EE_NO_ORGID);
        assert_eq!(t.org_name, Some("Acme Robotics"));
        assert_eq!(t.org_id, None);
    }

    #[test]
    fn rsa_key_is_reported_by_algorithm_oid() {
        let t = tbs(EE_RSA);
        assert_ne!(t.spki_alg_oid, OID_EC_PUBLIC_KEY);
        assert_eq!(t.spki_params_oid, None);
    }

    #[test]
    fn ca_certificate_parses_too() {
        let t = tbs(CA1);
        assert_eq!(t.org_name, Some("Mor Test QTSP"));
        assert_eq!(t.public_key.len(), 65);
    }

    #[test]
    fn rejects_indefinite_and_oversized_lengths() {
        assert_eq!(read_tlv(&[0x30, 0x80, 0x00, 0x00]).err(), Some(X509Error::Malformed));
        assert_eq!(read_tlv(&[0x30, 0x85, 1, 2, 3, 4, 5]).err(), Some(X509Error::Malformed));
        assert_eq!(read_tlv(&[0x30, 0x03, 1, 2]).err(), Some(X509Error::Malformed), "truncated");
        assert_eq!(read_tlv(&[0x30, 0x81, 0x01, 1]).err(), Some(X509Error::Malformed), "non-minimal long form");
        assert_eq!(read_tlv(&[]).err(), Some(X509Error::Malformed));
    }

    #[test]
    fn rejects_trailing_bytes_after_certificate() {
        let mut der = EE_SMALL.to_vec();
        der.push(0);
        assert_eq!(split_certificate(&der).err(), Some(X509Error::Malformed));
    }

    #[test]
    fn rejects_truncated_certificate() {
        let der = &EE_SMALL[..EE_SMALL.len() - 10];
        assert_eq!(split_certificate(der).err(), Some(X509Error::Malformed));
    }

    #[test]
    fn parses_times() {
        let utc = |s: &[u8]| parse_time(Tlv { tag: 0x17, body: s, raw: s }).unwrap();
        let gen = |s: &[u8]| parse_time(Tlv { tag: 0x18, body: s, raw: s }).unwrap();
        assert_eq!(utc(b"260101000000Z"), 1_767_225_600);
        assert_eq!(utc(b"500101000000Z"), -631_152_000, "50 -> 1950");
        assert_eq!(utc(b"490101000000Z"), 2_493_072_000, "49 -> 2049");
        assert_eq!(gen(b"20500101000000Z"), 2_524_608_000);
        assert_eq!(utc(b"260101000000Z"), gen(b"20260101000000Z"));
        assert_eq!(parse_time(Tlv { tag: 0x17, body: b"260101000000+0300", raw: b"" }).err(), Some(X509Error::BadTime));
        assert_eq!(parse_time(Tlv { tag: 0x17, body: b"261301000000Z", raw: b"" }).err(), Some(X509Error::BadTime));
    }

    #[test]
    fn rejects_field_over_limit() {
        // O длиной 129 байт: SEQUENCE { SET { SEQUENCE { OID 2.5.4.10, UTF8String(129) } } }
        let mut atv = vec![0x06, 0x03, 0x55, 0x04, 0x0a, 0x0c, 0x81, 0x81];
        atv.extend(std::iter::repeat(b'A').take(129));
        let mut set = vec![0x31, 0x81, (atv.len() + 3) as u8, 0x30, 0x81, atv.len() as u8];
        set.extend(atv);
        assert_eq!(parse_subject(&set).err(), Some(X509Error::FieldTooLong));
    }
}
