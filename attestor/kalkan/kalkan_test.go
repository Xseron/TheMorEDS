//go:build kalkan

package kalkan_test

import (
	"bytes"
	"crypto/x509"
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
// и по CRL отличает действующий сертификат от отозванного.
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
}
