//go:build kalkan

package server

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/mr-tron/base58"

	"mor/attestor/internal/testpki"
	"mor/attestor/kalkan"
	"mor/attestor/request"
	"mor/attestor/seal"
)

// kz объявлен в server.go того же пакета.
var (
	verifier    *kalkan.Verifier
	attestorKey ed25519.PrivateKey
	program     [32]byte
)

func TestMain(m *testing.M) {
	err := kalkan.Init(testpki.Lib())
	if err == nil {
		verifier, err = kalkan.NewVerifier(testpki.CAs(), testpki.CRLs())
	}
	if err == nil {
		attestorKey, err = seal.LoadKeypair(testpki.Path("fixtures", "keys", "attestor.json"))
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err, kalkan.Message(err))
		os.Exit(1)
	}
	raw, _ := base58.Decode("CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP")
	copy(program[:], raw)
	os.Exit(m.Run())
}

func handler(t *testing.T) http.Handler {
	t.Helper()
	h, err := New(Config{Verifier: verifier, Key: attestorKey, Program: program})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// newRequest — запрос на печать случайного кошелька на 5 лет: дольше любого тестового сертификата.
func newRequest(now time.Time) request.Request {
	var addr [32]byte
	rand.Read(addr[:])
	return request.Request{Program: program, Address: addr, Kind: seal.Wallet, Controller: addr,
		Expires: now.AddDate(5, 0, 0).Unix(), Deadline: now.Unix() + 600}
}

func post(h http.Handler, cms string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"cms": cms})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/attest", bytes.NewReader(body)))
	return rec
}

func signAs(role, state string) func(*testing.T, []byte) string {
	return func(t *testing.T, text []byte) string { return testpki.Sign(t, testpki.P12(t, role, state), text) }
}

// wrap переносит base64 по строкам, как может отдавать NCALayer.
func wrap(s string, n int) string {
	var b strings.Builder
	for len(s) > n {
		b.WriteString(s[:n] + "\r\n")
		s = s[n:]
	}
	b.WriteString(s)
	return b.String()
}

// Тест 4 спека: первый руководитель (действующий) — 200, подпись аттестатора верна,
// сообщение — ровно то, что ждёт register_seal_attested.
func TestAttestFirstHead(t *testing.T) {
	now := time.Now()
	req := newRequest(now)
	cms := signAs("Первый руководитель", "valid")(t, []byte(req.Text()))
	rec := post(handler(t), wrap(cms, 64))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var resp Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	msg, _ := base64.StdEncoding.DecodeString(resp.Message)
	sig, _ := base64.StdEncoding.DecodeString(resp.Signature)
	pub := attestorKey.Public().(ed25519.PublicKey)
	if !ed25519.Verify(pub, msg, sig) {
		t.Fatal("attestor signature does not verify")
	}

	_, der, err := verifier.Verify(cms)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	if resp.ExpiresAt != cert.NotAfter.Unix() {
		t.Fatalf("expiresAt %d: must be clamped to the certificate's notAfter %d", resp.ExpiresAt, cert.NotAfter.Unix())
	}
	if resp.Name != cert.Subject.Organization[0] || !utf8.ValidString(resp.Name) || len(resp.BIN) != 12 {
		t.Fatal("name must be the certificate's O as UTF-8, BIN — 12 digits")
	}
	saltBytes, _ := hex.DecodeString(resp.Salt)
	var salt [32]byte
	copy(salt[:], saltBytes)
	ih := seal.IdentifierHash(salt, kz, resp.BIN)
	ts, _ := seal.TrustServicePDA(program, pub)
	want := seal.Message{Program: program, Address: req.Address, Kind: seal.Wallet, Controller: req.Controller,
		TrustLevel: seal.TrustAttestor, TrustService: ts, Jurisdiction: kz, SubjectType: seal.LegalEntity,
		IdentifierHash: ih, ExpiresAt: cert.NotAfter.Unix(), SignDeadline: req.Deadline, Name: resp.Name}
	wb, _ := want.Bytes()
	if !bytes.Equal(wb, msg) || resp.IdentifierHash != hex.EncodeToString(ih[:]) ||
		resp.TrustService != base58.Encode(ts[:]) || resp.Attestor != base58.Encode(pub) || resp.SignDeadline != req.Deadline {
		t.Fatalf("response does not match the expected seal message: %s", rec.Body)
	}
}

// Тесты 5–8 спека и поддельная цепочка.
func TestAttestRejects(t *testing.T) {
	cases := []struct {
		name   string
		cms    func(*testing.T, []byte) string
		status int
		code   string
	}{
		{"employee with signing right", signAs("Сотрудник с правом подписи", "valid"), http.StatusOK, ""},
		{"treasury client (no signing role)", signAs("Казначейство клиент", "valid"), http.StatusForbidden, "role_not_allowed"},
		{"revoked first head", signAs("Первый руководитель", "revoke"), http.StatusForbidden, "revoked"},
		{"tampered CMS", tampered, http.StatusUnauthorized, "bad_signature"},
		{"forged chain", forged, http.StatusUnauthorized, "bad_signature"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := post(handler(t), c.cms(t, []byte(newRequest(time.Now()).Text())))
			var body struct {
				Error string `json:"error"`
			}
			json.Unmarshal(rec.Body.Bytes(), &body)
			if rec.Code != c.status || body.Error != c.code {
				t.Fatalf("got %d %q, want %d %q: %s", rec.Code, body.Error, c.status, c.code, rec.Body)
			}
		})
	}
}

// tampered — CMS первого руководителя, в которой изменена одна буква подписанного текста.
func tampered(t *testing.T, text []byte) string {
	der, _ := base64.StdEncoding.DecodeString(signAs("Первый руководитель", "valid")(t, text))
	i := bytes.Index(der, []byte(request.Header))
	if i < 0 {
		t.Fatal("request text not found inside the CMS")
	}
	der[i] ^= 0x20 // 'M' → 'm'
	return base64.StdEncoding.EncodeToString(der)
}

// forged — CMS «первого руководителя» с правильными O, OU=BIN… и EKU, чей издатель носит DN
// и SubjectKeyId промежуточного УЦ НУЦ, но подписан чужим ключом RSA. Подписывает сама
// KalkanCrypt (p12 собирает openssl), чтобы формат CMS был как у настоящей и отказ шёл только
// от цепочки.
func forged(t *testing.T, text []byte) string {
	raw, err := os.ReadFile(testpki.CAs()[1])
	if err != nil {
		t.Fatal(err)
	}
	nca, err := x509.ParseCertificate(raw)
	if err != nil {
		t.Fatal(err)
	}
	subject := pkix.Name{Country: []string{"KZ"}, Organization: []string{"ТОО «Подделка»"},
		OrganizationalUnit: []string{"BIN123456789012"}, CommonName: "FORGED"}
	der, key := testpki.ForgedCert(t, nca, big.NewInt(2), subject, nil)
	// KalkanCrypt строит цепочку поддельного сертификата только после того, как одна настоящая
	// подпись НУЦ прогрела её кэш; без этого SignData падает с 0x08f00042 при запуске строки
	// отдельно. Результат прогрева не нужен.
	signAs("Первый руководитель", "valid")(t, text)
	return testpki.Sign(t, testpki.P12FromKey(t, der, key), text)
}
