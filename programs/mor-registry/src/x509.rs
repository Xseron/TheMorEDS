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

const TAG_BOOLEAN: u8 = 0x01;
const TAG_INTEGER: u8 = 0x02;
const TAG_BIT_STRING: u8 = 0x03;
const TAG_OCTET_STRING: u8 = 0x04;
const TAG_OID: u8 = 0x06;
const TAG_UTF8_STRING: u8 = 0x0c;
const TAG_PRINTABLE_STRING: u8 = 0x13;
const TAG_UTC_TIME: u8 = 0x17;
const TAG_GENERALIZED_TIME: u8 = 0x18;
const TAG_SEQUENCE: u8 = 0x30;
const TAG_SET: u8 = 0x31;
const TAG_VERSION: u8 = 0xa0; // [0] EXPLICIT
const TAG_EXTENSIONS: u8 = 0xa3; // [3] EXPLICIT

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
    /// В subject есть surname, givenName, serialNumber или pseudonym.
    pub has_person_attrs: bool,
    /// basicConstraints cA; false, если расширения нет.
    pub ca: bool,
    /// Биты KeyUsage (бит n — `1 << n`); None, если расширения нет.
    pub key_usage: Option<u16>,
    /// Есть критичное расширение, которое реестр не знает.
    pub unknown_critical: bool,
    /// extKeyUsage содержит serverAuth, timeStamping или OCSPSigning.
    pub forbidden_purpose: bool,
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
    let (spki, after_spki) = expect(cur, TAG_SEQUENCE)?;
    let ext = parse_extensions(after_spki)?;

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
        ca: ext.ca,
        key_usage: ext.key_usage,
        unknown_critical: ext.unknown_critical,
        forbidden_purpose: ext.forbidden_purpose,
    })
}

#[derive(Default)]
struct Extensions {
    ca: bool,
    key_usage: Option<u16>,
    unknown_critical: bool,
    forbidden_purpose: bool,
}

/// Хвост TBS после SubjectPublicKeyInfo: пусто или ровно `[3] EXPLICIT Extensions`, где
/// Extensions ::= SEQUENCE SIZE (1..MAX) OF Extension,
/// Extension ::= SEQUENCE { extnID OID, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }.
/// issuerUniqueID/subjectUniqueID (v2, RFC 5280 запрещает их выпускать) и любой другой хвост — Malformed.
fn parse_extensions(after_spki: &[u8]) -> R<Extensions> {
    let mut out = Extensions::default();
    if after_spki.is_empty() {
        return Ok(out);
    }
    let (wrapper, rest) = expect(after_spki, TAG_EXTENSIONS)?;
    if !rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    let (list, rest) = expect(wrapper.body, TAG_SEQUENCE)?;
    if !rest.is_empty() || list.body.is_empty() {
        return Err(X509Error::Malformed);
    }
    let mut seen_basic_constraints = false;
    let mut seen_ext_key_usage = false;
    let mut body = list.body;
    while !body.is_empty() {
        let (ext, rest) = expect(body, TAG_SEQUENCE)?;
        body = rest;
        let (oid, e_rest) = expect(ext.body, TAG_OID)?;
        let (critical, e_rest) = match e_rest.first() {
            Some(&TAG_BOOLEAN) => {
                let (flag, e_rest) = read_tlv(e_rest)?;
                (boolean(flag)?, e_rest)
            }
            _ => (false, e_rest),
        };
        let (value, e_rest) = expect(e_rest, TAG_OCTET_STRING)?;
        if !e_rest.is_empty() {
            return Err(X509Error::Malformed);
        }
        let oid = oid.body;
        // Повтор расширения запрещён RFC 5280 и сделал бы результат зависимым от порядка.
        if oid == OID_BASIC_CONSTRAINTS {
            if seen_basic_constraints {
                return Err(X509Error::Malformed);
            }
            seen_basic_constraints = true;
            out.ca = basic_constraints_ca(value.body)?;
        } else if oid == OID_KEY_USAGE {
            if out.key_usage.is_some() {
                return Err(X509Error::Malformed);
            }
            out.key_usage = Some(key_usage_bits(value.body)?);
        } else if oid == OID_EXT_KEY_USAGE {
            if seen_ext_key_usage {
                return Err(X509Error::Malformed);
            }
            seen_ext_key_usage = true;
            out.forbidden_purpose = ext_key_usage_forbidden(value.body)?;
        } else if critical && oid != OID_CERT_POLICIES && oid != OID_SUBJECT_ALT_NAME {
            out.unknown_critical = true;
        }
    }
    Ok(out)
}

/// DER BOOLEAN: FF — истина, 00 — ложь (явный FALSE вместо DEFAULT выпускают некоторые УЦ,
/// читается он однозначно). Другие значения и длины — Malformed.
fn boolean(tlv: Tlv<'_>) -> R<bool> {
    match (tlv.tag, tlv.body) {
        (TAG_BOOLEAN, [0xff]) => Ok(true),
        (TAG_BOOLEAN, [0x00]) => Ok(false),
        _ => Err(X509Error::Malformed),
    }
}

/// BasicConstraints ::= SEQUENCE { cA BOOLEAN DEFAULT FALSE, pathLenConstraint INTEGER OPTIONAL }.
fn basic_constraints_ca(value: &[u8]) -> R<bool> {
    let (seq, rest) = expect(value, TAG_SEQUENCE)?;
    if !rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    let mut cur = seq.body;
    let mut ca = false;
    if cur.first() == Some(&TAG_BOOLEAN) {
        let (flag, rest) = read_tlv(cur)?;
        ca = boolean(flag)?;
        cur = rest;
    }
    if cur.first() == Some(&TAG_INTEGER) {
        let (path_len, rest) = read_tlv(cur)?;
        if path_len.body.is_empty() {
            return Err(X509Error::Malformed);
        }
        cur = rest;
    }
    if !cur.is_empty() {
        return Err(X509Error::Malformed);
    }
    Ok(ca)
}

/// ExtKeyUsageSyntax ::= SEQUENCE SIZE (1..MAX) OF KeyPurposeId (OID).
/// true, если среди назначений есть serverAuth, timeStamping или OCSPSigning.
fn ext_key_usage_forbidden(value: &[u8]) -> R<bool> {
    let (seq, rest) = expect(value, TAG_SEQUENCE)?;
    if !rest.is_empty() || seq.body.is_empty() {
        return Err(X509Error::Malformed);
    }
    let mut body = seq.body;
    let mut forbidden = false;
    while !body.is_empty() {
        let (oid, rest) = expect(body, TAG_OID)?;
        body = rest;
        if oid.body == OID_KP_SERVER_AUTH || oid.body == OID_KP_TIME_STAMPING || oid.body == OID_KP_OCSP_SIGNING {
            forbidden = true;
        }
    }
    Ok(forbidden)
}

/// KeyUsage ::= BIT STRING; именованные биты 0..8 умещаются в 2 байта. Бит n (0 — старший бит
/// первого байта) → `1 << n`. Неиспользуемых битов 0..7, при пустом содержимом — 0, и сами
/// неиспользуемые биты должны быть нулями (DER).
fn key_usage_bits(value: &[u8]) -> R<u16> {
    let (bits, rest) = expect(value, TAG_BIT_STRING)?;
    if !rest.is_empty() {
        return Err(X509Error::Malformed);
    }
    let (&unused, bytes) = bits.body.split_first().ok_or(X509Error::Malformed)?;
    if unused > 7 || bytes.len() > 2 || (bytes.is_empty() && unused != 0) {
        return Err(X509Error::Malformed);
    }
    if let Some(last) = bytes.last() {
        if last & ((1u8 << unused) - 1) != 0 {
            return Err(X509Error::Malformed);
        }
    }
    let mut out = 0u16;
    for (i, byte) in bytes.iter().enumerate() {
        for k in 0..8 {
            if byte & (0x80 >> k) != 0 {
                out |= 1 << (i * 8 + k);
            }
        }
    }
    Ok(out)
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
            } else if oid == OID_SURNAME || oid == OID_GIVEN_NAME || oid == OID_SERIAL_NUMBER || oid == OID_PSEUDONYM {
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
    fn detects_pseudonym_as_person_attribute() {
        // Name с O и organizationIdentifier; с pseudonym (2.5.4.65 = 55 04 41) и без него.
        let rdn = |oid: &[u8], value: &[u8]| {
            let atv = [test_der::tlv(TAG_OID, oid), test_der::tlv(TAG_UTF8_STRING, value)].concat();
            test_der::tlv(TAG_SET, &test_der::tlv(TAG_SEQUENCE, &atv))
        };
        let org = [rdn(&[0x55, 0x04, 0x0a], b"Acme Robotics"), rdn(&[0x55, 0x04, 0x61], b"NTREE-12345678")].concat();
        let a = parse_subject(&org).unwrap();
        assert_eq!((a.org_name, a.org_id, a.has_person_attrs), (Some("Acme Robotics"), Some("NTREE-12345678"), false));
        let with_pseudonym = [org, rdn(&[0x55, 0x04, 0x41], b"Mari-7")].concat();
        assert!(parse_subject(&with_pseudonym).unwrap().has_person_attrs);
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
    fn reads_end_entity_extensions() {
        for der in [EE_SMALL, EE_LARGE] {
            let t = tbs(der);
            assert!(!t.ca);
            assert_eq!(t.key_usage, Some(KU_NON_REPUDIATION));
            assert!(!t.unknown_critical);
        }
    }

    #[test]
    fn reads_ca_extensions() {
        let t = tbs(CA1);
        assert!(t.ca);
        assert_eq!(t.key_usage, Some(KU_KEY_CERT_SIGN | KU_CRL_SIGN));
        assert!(!t.unknown_critical);
    }

    const OID_UNKNOWN: &[u8] = &[0x2a, 0x03, 0x04]; // 1.2.3.4
    const NULL: &[u8] = &[0x05, 0x00];

    #[test]
    fn absent_extensions_mean_not_ca_and_no_key_usage() {
        let e = parse_extensions(&[]).unwrap();
        assert!(!e.ca);
        assert_eq!(e.key_usage, None);
        assert!(!e.unknown_critical);
    }

    const OID_KP_CLIENT_AUTH: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x02]; // 1.3.6.1.5.5.7.3.2
    const OID_KP_EMAIL_PROTECTION: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x04]; // 1.3.6.1.5.5.7.3.4

    #[test]
    fn flags_forbidden_key_purposes_only() {
        let eku = |purposes: &[&[u8]]| {
            parse_extensions(&test_der::extensions(&[test_der::extension(
                OID_EXT_KEY_USAGE,
                false,
                &test_der::ext_key_usage(purposes),
            )]))
        };
        assert!(eku(&[OID_KP_OCSP_SIGNING]).unwrap().forbidden_purpose);
        assert!(eku(&[OID_KP_CLIENT_AUTH, OID_KP_SERVER_AUTH]).unwrap().forbidden_purpose);
        assert!(!eku(&[OID_KP_CLIENT_AUTH, OID_KP_EMAIL_PROTECTION]).unwrap().forbidden_purpose);
        assert_eq!(eku(&[]).err(), Some(X509Error::Malformed), "empty SEQUENCE");
    }

    #[test]
    fn flags_only_unknown_critical_extensions() {
        let ku = test_der::extension(OID_KEY_USAGE, true, &test_der::key_usage(6, &[0x40]));
        let crit = |oid: &[u8]| test_der::extensions(&[ku.clone(), test_der::extension(oid, true, NULL)]);
        assert!(parse_extensions(&crit(OID_UNKNOWN)).unwrap().unknown_critical);
        let eku = test_der::extension(OID_EXT_KEY_USAGE, true, &test_der::ext_key_usage(&[OID_KP_CLIENT_AUTH]));
        assert!(!parse_extensions(&test_der::extensions(&[ku.clone(), eku])).unwrap().unknown_critical);
        for known in [OID_CERT_POLICIES, OID_SUBJECT_ALT_NAME] {
            assert!(!parse_extensions(&crit(known)).unwrap().unknown_critical);
        }
        let non_critical = test_der::extensions(&[ku.clone(), test_der::extension(OID_UNKNOWN, false, NULL)]);
        assert!(!parse_extensions(&non_critical).unwrap().unknown_critical);
        // critical FALSE, закодированный явно, читается как «не критично».
        let mut explicit_false = test_der::tlv(TAG_OID, OID_UNKNOWN);
        explicit_false.extend([TAG_BOOLEAN, 0x01, 0x00]);
        explicit_false.extend(test_der::tlv(TAG_OCTET_STRING, NULL));
        let blob = test_der::extensions(&[ku, test_der::tlv(TAG_SEQUENCE, &explicit_false)]);
        assert!(!parse_extensions(&blob).unwrap().unknown_critical);
    }

    #[test]
    fn reads_basic_constraints() {
        let bc = |value: &[u8]| {
            parse_extensions(&test_der::extensions(&[test_der::extension(OID_BASIC_CONSTRAINTS, true, value)]))
        };
        assert!(bc(&test_der::basic_constraints(true)).unwrap().ca);
        assert!(!bc(&test_der::basic_constraints(false)).unwrap().ca);
        assert!(bc(&[0x30, 0x06, 0x01, 0x01, 0xff, 0x02, 0x01, 0x00]).unwrap().ca, "with pathLenConstraint");
        assert!(!bc(&[0x30, 0x03, 0x01, 0x01, 0x00]).unwrap().ca, "explicit FALSE");
        assert_eq!(bc(&[0x30, 0x03, 0x01, 0x01, 0x01]).err(), Some(X509Error::Malformed), "non-DER TRUE");
        assert_eq!(bc(&[0x30, 0x05, 0x01, 0x01, 0xff, 0x05, 0x00]).err(), Some(X509Error::Malformed), "junk inside");
        assert_eq!(bc(&[0x30, 0x00, 0x00]).err(), Some(X509Error::Malformed), "trailing byte");
    }

    #[test]
    fn decodes_key_usage_bits() {
        let ku = |unused: u8, bits: &[u8]| {
            parse_extensions(&test_der::extensions(&[test_der::extension(
                OID_KEY_USAGE,
                true,
                &test_der::key_usage(unused, bits),
            )]))
            .map(|e| e.key_usage)
        };
        assert_eq!(ku(7, &[0x80]), Ok(Some(KU_DIGITAL_SIGNATURE)));
        assert_eq!(ku(6, &[0x40]), Ok(Some(KU_NON_REPUDIATION)));
        assert_eq!(ku(6, &[0xc0]), Ok(Some(KU_DIGITAL_SIGNATURE | KU_NON_REPUDIATION)));
        assert_eq!(ku(1, &[0x06]), Ok(Some(KU_KEY_CERT_SIGN | KU_CRL_SIGN)));
        assert_eq!(ku(7, &[0x80, 0x80]), Ok(Some(KU_DIGITAL_SIGNATURE | 1 << 8)), "decipherOnly is bit 8");
        assert_eq!(ku(0, &[]), Ok(Some(0)));
        assert_eq!(ku(8, &[0x80]), Err(X509Error::Malformed), "unused > 7");
        assert_eq!(ku(6, &[0x41]), Err(X509Error::Malformed), "padding bit set");
        assert_eq!(ku(1, &[]), Err(X509Error::Malformed), "unused bits without content");
        assert_eq!(ku(0, &[0x80, 0x00, 0x01]), Err(X509Error::Malformed), "more than 16 bits");
    }

    #[test]
    fn rejects_malformed_extensions() {
        let ku = test_der::extension(OID_KEY_USAGE, true, &test_der::key_usage(6, &[0x40]));
        let bc = test_der::extension(OID_BASIC_CONSTRAINTS, true, &test_der::basic_constraints(false));
        let good = test_der::extensions(&[bc.clone(), ku.clone()]);
        assert!(parse_extensions(&good).is_ok());

        let mut trailing = good.clone();
        trailing.extend(NULL);
        assert_eq!(parse_extensions(&trailing).err(), Some(X509Error::Malformed), "bytes after extensions");
        let unique_id = [0x81, 0x02, 0x00, 0x00];
        assert_eq!(parse_extensions(&unique_id).err(), Some(X509Error::Malformed), "not [3]");
        let empty = test_der::tlv(TAG_EXTENSIONS, &test_der::tlv(TAG_SEQUENCE, &[]));
        assert_eq!(parse_extensions(&empty).err(), Some(X509Error::Malformed), "empty SEQUENCE OF");
        let dup_ku = test_der::extensions(&[ku.clone(), ku.clone()]);
        assert_eq!(parse_extensions(&dup_ku).err(), Some(X509Error::Malformed), "duplicate keyUsage");
        let dup_bc = test_der::extensions(&[bc.clone(), bc.clone(), ku.clone()]);
        assert_eq!(parse_extensions(&dup_bc).err(), Some(X509Error::Malformed), "duplicate basicConstraints");
        let no_value = test_der::extensions(&[test_der::tlv(TAG_SEQUENCE, &test_der::tlv(TAG_OID, OID_UNKNOWN))]);
        assert_eq!(parse_extensions(&no_value).err(), Some(X509Error::Malformed), "no extnValue");
        let mut bad_bool = test_der::tlv(TAG_OID, OID_UNKNOWN);
        bad_bool.extend([TAG_BOOLEAN, 0x01, 0x01]);
        bad_bool.extend(test_der::tlv(TAG_OCTET_STRING, NULL));
        let bad_bool = test_der::extensions(&[test_der::tlv(TAG_SEQUENCE, &bad_bool)]);
        assert_eq!(parse_extensions(&bad_bool).err(), Some(X509Error::Malformed), "critical is not 00/FF");
        let mut ku_junk = test_der::key_usage(6, &[0x40]);
        ku_junk.extend(NULL);
        let ku_junk = test_der::extensions(&[test_der::extension(OID_KEY_USAGE, true, &ku_junk)]);
        assert_eq!(parse_extensions(&ku_junk).err(), Some(X509Error::Malformed), "junk after KeyUsage");
        let truncated = &good[..good.len() - 1];
        assert_eq!(parse_extensions(truncated).err(), Some(X509Error::Malformed), "truncated");
    }

    #[test]
    fn parse_tbs_rejects_bytes_after_extensions() {
        let (tbs_der, _) = split_certificate(EE_SMALL).unwrap();
        let (seq, _) = read_tlv(tbs_der).unwrap();
        let mut body = seq.body.to_vec();
        body.extend(NULL);
        let tampered = test_der::tlv(TAG_SEQUENCE, &body);
        assert_eq!(parse_tbs(&tampered).err(), Some(X509Error::Malformed));
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

/// DER-конструктор для тестов: собирает расширения и TBS с подменённым хвостом.
#[cfg(test)]
pub(crate) mod test_der {
    use super::*;

    /// TLV с длиной в короткой или длинной (до 2 байт) форме.
    pub fn tlv(tag: u8, body: &[u8]) -> Vec<u8> {
        let mut out = vec![tag];
        match body.len() {
            n if n < 0x80 => out.push(n as u8),
            n if n <= 0xff => out.extend([0x81, n as u8]),
            n => out.extend([0x82, (n >> 8) as u8, n as u8]),
        }
        out.extend_from_slice(body);
        out
    }

    /// Extension ::= SEQUENCE { extnID, critical BOOLEAN DEFAULT FALSE, extnValue OCTET STRING }.
    pub fn extension(oid: &[u8], critical: bool, value: &[u8]) -> Vec<u8> {
        let mut body = tlv(TAG_OID, oid);
        if critical {
            body.extend([TAG_BOOLEAN, 0x01, 0xff]);
        }
        body.extend(tlv(TAG_OCTET_STRING, value));
        tlv(TAG_SEQUENCE, &body)
    }

    /// [3] EXPLICIT SEQUENCE OF Extension.
    pub fn extensions(list: &[Vec<u8>]) -> Vec<u8> {
        tlv(TAG_EXTENSIONS, &tlv(TAG_SEQUENCE, &list.concat()))
    }

    /// Значение KeyUsage: BIT STRING с указанным числом неиспользуемых битов.
    pub fn key_usage(unused: u8, bits: &[u8]) -> Vec<u8> {
        tlv(TAG_BIT_STRING, &[&[unused][..], bits].concat())
    }

    /// Значение extKeyUsage: SEQUENCE OF KeyPurposeId (OID).
    pub fn ext_key_usage(purposes: &[&[u8]]) -> Vec<u8> {
        let body: Vec<u8> = purposes.iter().flat_map(|p| tlv(TAG_OID, p)).collect();
        tlv(TAG_SEQUENCE, &body)
    }

    /// Значение BasicConstraints: CA:TRUE — `30 03 01 01 FF`, CA:FALSE — пустой SEQUENCE.
    pub fn basic_constraints(ca: bool) -> Vec<u8> {
        let body: &[u8] = if ca { &[TAG_BOOLEAN, 0x01, 0xff] } else { &[] };
        tlv(TAG_SEQUENCE, body)
    }

    /// TBS, в котором всё после SubjectPublicKeyInfo заменено на `tail`.
    pub fn replace_extensions(tbs: &[u8], tail: &[u8]) -> Vec<u8> {
        let (seq, _) = read_tlv(tbs).unwrap();
        let spki = parse_tbs(tbs).unwrap().spki;
        let end = spki.as_ptr() as usize - seq.body.as_ptr() as usize + spki.len();
        tlv(TAG_SEQUENCE, &[&seq.body[..end], tail].concat())
    }
}
