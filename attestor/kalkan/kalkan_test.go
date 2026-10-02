//go:build kalkan

package kalkan_test

import (
	"bytes"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"mor/attestor/internal/testpki"
	"mor/attestor/kalkan"
)

func TestMain(m *testing.M) {
	if err := kalkan.Init(testpki.Lib()); err != nil {
		fmt.Fprintln(os.Stderr, err, kalkan.Message(err))
		os.Exit(1)
	}
	os.Exit(m.Run())
}

// Спайк: KalkanCrypt подписывает ключом НУЦ (ГОСТ 2015), проверяет присоединённую CMS
// с цепочкой до тестового УЦ НУЦ 2022, отдаёт сертификат подписанта с полями юрлица
// и по CRL отличает действующий сертификат от отозванного. Испорченная подпись, подмена
// подписанта и CMS с двумя подписантами отклоняются как ErrBadSignature.
func TestSignVerifyCRL(t *testing.T) {
	v, err := kalkan.NewVerifier(testpki.CAs(), testpki.CRLs())
	if err != nil {
		t.Fatalf("%v (%s)", err, kalkan.Message(err))
	}
	data := []byte("MOR spike: присоединённая подпись")

	cms := testpki.Sign(t, testpki.P12(t, "Первый руководитель", "valid"), data)
	got, der, err := v.Verify(cms)
	if err != nil {
		t.Fatalf("verify: %v (%s)", err, kalkan.Message(err))
	}
	if !bytes.Equal(got, data) {
		t.Fatalf("signed data %q, want %q", got, data)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	var eku []string
	for _, oid := range cert.UnknownExtKeyUsage {
		eku = append(eku, oid.String())
	}
	if !slices.Contains(eku, "1.2.398.3.3.4.1.2.1") {
		t.Fatalf("EKU %v: no first-head role", eku)
	}
	hasBIN := slices.ContainsFunc(cert.Subject.OrganizationalUnit, func(s string) bool { return strings.HasPrefix(s, "BIN") })
	if len(cert.Subject.Organization) != 1 || !hasBIN {
		t.Fatal("signer certificate has no O or no OU=BIN…")
	}

	revoked := testpki.Sign(t, testpki.P12(t, "Первый руководитель", "revoke"), data)
	if _, _, err := v.Verify(revoked); !errors.Is(err, kalkan.ErrRevoked) {
		t.Fatalf("revoked certificate: got %v (%s), want ErrRevoked", err, kalkan.Message(err))
	}

	// Подделки собираются из настоящих CMS разбором ASN.1, без криптографии.
	victim := parseCMS(t, cms)
	signer := testpki.P12(t, "Сотрудник с правом подписи", "valid")
	other := parseCMS(t, testpki.Sign(t, signer, []byte("данные, которые первый руководитель не подписывал")))
	second := parseCMS(t, testpki.Sign(t, signer, data))
	forged := []struct{ name, cms string }{
		// Один байт значения подписи изменён; содержимое и его хэш в подписанных атрибутах целы.
		{"corrupted signature", victim.build(t, victim.certs(t), [][]byte{corruptSignature(t, victim.signers(t)[0])})},
		// Другой сотрудник подписал свои данные своим ключом, а sid и набор сертификатов
		// указывают на первого руководителя.
		{"signer impersonation", other.build(t, victim.certs(t), [][]byte{withSid(t, other.signers(t)[0], victim.signers(t)[0])})},
		// Две верные подписи одних данных: аттестатор принимает только одного подписанта.
		{"two signers", victim.build(t, append(victim.certs(t), second.certs(t)...), append(victim.signers(t), second.signers(t)...))},
	}
	for _, f := range forged {
		if _, _, err := v.Verify(f.cms); !errors.Is(err, kalkan.ErrBadSignature) {
			t.Errorf("%s: got %v (%s), want ErrBadSignature", f.name, err, kalkan.Message(err))
		}
	}
}

// signedData — присоединённая CMS, разобранная до полей SignedData (RFC 5652): contentType
// ContentInfo и поля SignedData по порядку; сертификаты — поле [0], SignerInfos — последнее.
type signedData struct {
	contentType []byte
	fields      []asn1.RawValue
}

func parseCMS(t *testing.T, cmsB64 string) signedData {
	t.Helper()
	der, err := base64.StdEncoding.DecodeString(cmsB64)
	if err != nil {
		t.Fatal(err)
	}
	// SignData KalkanCrypt кодирует в base64 и нулевой байт после DER — он отбрасывается.
	var top asn1.RawValue
	if _, err := asn1.Unmarshal(der, &top); err != nil {
		t.Fatal(err)
	}
	ci := elements(t, top.FullBytes) // contentType, [0] EXPLICIT SignedData
	return signedData{contentType: ci[0].FullBytes, fields: elements(t, elements(t, ci[1].FullBytes)[0].FullBytes)}
}

func (sd signedData) certIndex(t *testing.T) int {
	t.Helper()
	for i, f := range sd.fields {
		if f.Class == asn1.ClassContextSpecific && f.Tag == 0 {
			return i
		}
	}
	t.Fatal("CMS has no certificates")
	return -1
}

func (sd signedData) certs(t *testing.T) [][]byte {
	return fullBytes(elements(t, sd.fields[sd.certIndex(t)].FullBytes))
}

func (sd signedData) signers(t *testing.T) [][]byte {
	return fullBytes(elements(t, sd.fields[len(sd.fields)-1].FullBytes))
}

// build — та же CMS (base64) с другими сертификатами и SignerInfos.
func (sd signedData) build(t *testing.T, certs, signers [][]byte) string {
	t.Helper()
	ci := sd.certIndex(t)
	var fields [][]byte
	for i, f := range sd.fields {
		switch i {
		case ci:
			fields = append(fields, constructed(t, asn1.ClassContextSpecific, 0, certs...))
		case len(sd.fields) - 1:
			fields = append(fields, constructed(t, asn1.ClassUniversal, asn1.TagSet, signers...))
		default:
			fields = append(fields, f.FullBytes)
		}
	}
	content := constructed(t, asn1.ClassContextSpecific, 0, constructed(t, asn1.ClassUniversal, asn1.TagSequence, fields...))
	return base64.StdEncoding.EncodeToString(constructed(t, asn1.ClassUniversal, asn1.TagSequence, sd.contentType, content))
}

// corruptSignature меняет один байт в значении подписи SignerInfo (последняя OCTET STRING).
func corruptSignature(t *testing.T, si []byte) []byte {
	t.Helper()
	f := elements(t, si)
	for i := len(f) - 1; i >= 0; i-- {
		if f[i].Class == asn1.ClassUniversal && f[i].Tag == asn1.TagOctetString {
			sig := bytes.Clone(f[i].Bytes)
			sig[len(sig)/2] ^= 0xff
			b, err := asn1.Marshal(asn1.RawValue{Tag: asn1.TagOctetString, Bytes: sig})
			if err != nil {
				t.Fatal(err)
			}
			f[i].FullBytes = b
			return constructed(t, asn1.ClassUniversal, asn1.TagSequence, fullBytes(f)...)
		}
	}
	t.Fatal("SignerInfo has no signature")
	return nil
}

// withSid — SignerInfo si с идентификатором подписанта (sid, второе поле) из from.
func withSid(t *testing.T, si, from []byte) []byte {
	t.Helper()
	f := elements(t, si)
	f[1] = elements(t, from)[1]
	return constructed(t, asn1.ClassUniversal, asn1.TagSequence, fullBytes(f)...)
}

// elements — элементы конструктивного значения DER.
func elements(t *testing.T, der []byte) []asn1.RawValue {
	t.Helper()
	var outer asn1.RawValue
	if rest, err := asn1.Unmarshal(der, &outer); err != nil || len(rest) != 0 {
		t.Fatalf("CMS ASN.1: %v, %d trailing bytes", err, len(rest))
	}
	var out []asn1.RawValue
	for b := outer.Bytes; len(b) > 0; {
		var e asn1.RawValue
		var err error
		if b, err = asn1.Unmarshal(b, &e); err != nil {
			t.Fatalf("CMS ASN.1: %v", err)
		}
		out = append(out, e)
	}
	return out
}

func constructed(t *testing.T, class, tag int, parts ...[]byte) []byte {
	t.Helper()
	b, err := asn1.Marshal(asn1.RawValue{Class: class, Tag: tag, IsCompound: true, Bytes: bytes.Join(parts, nil)})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func fullBytes(vs []asn1.RawValue) [][]byte {
	out := make([][]byte, len(vs))
	for i, v := range vs {
		out[i] = v.FullBytes
	}
	return out
}
