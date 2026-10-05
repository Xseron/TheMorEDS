//go:build kalkan

package testpki

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"mor/attestor/kalkan"
)

// Password общий для всех тестовых ключей НУЦ в SDK
const Password = "Qwerty12"

// Path считает от корня репозитория
func Path(parts ...string) string {
	return filepath.Join(append([]string{root()}, parts...)...)
}

func root() string {
	dir, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "Anchor.toml")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			panic("testpki: repository root (Anchor.toml) not found")
		}
		dir = parent
	}
}

func Lib() string {
	if p := os.Getenv("KALKAN_LIB"); p != "" {
		return p
	}
	return Path("pkisdk", "C", "Linux", "C", "libs", "v2.0.2 (Сертифицированная версия)", "libkalkancryptwr-64.so.2.0.2")
}

// CAs отдаёт сначала корневой, потом промежуточный
func CAs() []string {
	return []string{
		Path("pkisdk", "Keys and Certs", "CA_Test", "ROOT", "root_test_gost_2022.cer"),
		Path("pkisdk", "Keys and Certs", "CA_Test", "NCA", "nca_gost2022_test.cer"),
	}
}

func CRLs() []string {
	return []string{Path("pkisdk", "nca_gost2022_test.crl")}
}

// P12 ищет ключ юрлица по каталогам SDK, например role "Первый руководитель" и state valid или revoke
func P12(t testing.TB, role, state string) string {
	t.Helper()
	m, err := filepath.Glob(Path("pkisdk", "Keys and Certs", "Gost2015", "2026.05.08-2027.05.07", "Юридическое лицо", role, state, "*.p12"))
	if err != nil || len(m) != 1 {
		t.Fatalf("testpki: want one .p12 for %s/%s, got %v (%v)", role, state, m, err)
	}
	return m[0]
}

func Sign(t testing.TB, p12 string, data []byte) string {
	t.Helper()
	if err := kalkan.LoadKeyStore(p12, Password); err != nil {
		t.Fatalf("load %s: %v (%s)", filepath.Base(p12), err, kalkan.Message(err))
	}
	cms, err := kalkan.SignCMS(data)
	if err != nil {
		t.Fatalf("sign: %v (%s)", err, kalkan.Message(err))
	}
	return cms
}

// ForgedCert выпускает RSA-сертификат от поддельного УЦ с DN и SubjectKeyId настоящего issuer,
// подписанный одноразовым ключом. ski может быть nil
func ForgedCert(t testing.TB, issuer *x509.Certificate, serial *big.Int, subject pkix.Name, ski []byte) ([]byte, *rsa.PrivateKey) {
	t.Helper()
	now := time.Now()
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), RawSubject: issuer.RawSubject, SubjectKeyId: issuer.SubjectKeyId,
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: serial, Subject: subject, SubjectKeyId: ski,
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(24 * time.Hour),
		KeyUsage:           x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		UnknownExtKeyUsage: []asn1.ObjectIdentifier{{1, 2, 398, 3, 3, 4, 1, 2}, {1, 2, 398, 3, 3, 4, 1, 2, 1}},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	return leafDER, key
}

// P12FromKey собирает p12 через openssl со старыми PBE: такие KalkanCrypt читает
func P12FromKey(t testing.TB, certDER []byte, key *rsa.PrivateKey) string {
	t.Helper()
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certPEM, keyPEM, p12 := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem"), filepath.Join(dir, "forged.p12")
	if err := os.WriteFile(certPEM, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPEM, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command("openssl", "pkcs12", "-export", "-inkey", keyPEM, "-in", certPEM, "-out", p12,
		"-passout", "pass:"+Password, "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1").CombinedOutput()
	if err != nil {
		t.Fatalf("openssl pkcs12: %v: %s", err, out)
	}
	return p12
}
