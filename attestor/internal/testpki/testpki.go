//go:build kalkan

package testpki

import (
	"os"
	"path/filepath"
	"testing"

	"mor/attestor/kalkan"
)

// Password — пароль всех тестовых ключей НУЦ в SDK.
const Password = "Qwerty12"

// Path — путь от корня репозитория (каталог с Anchor.toml).
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

// Lib — путь к KalkanCrypt: KALKAN_LIB или сертифицированная 2.0.2 из SDK.
func Lib() string {
	if p := os.Getenv("KALKAN_LIB"); p != "" {
		return p
	}
	return Path("pkisdk", "C", "Linux", "C", "libs", "v2.0.2 (Сертифицированная версия)", "libkalkancryptwr-64.so.2.0.2")
}

// CAs — тестовые УЦ НУЦ 2022: корневой, затем промежуточный.
func CAs() []string {
	return []string{
		Path("pkisdk", "Keys and Certs", "CA_Test", "ROOT", "root_test_gost_2022.cer"),
		Path("pkisdk", "Keys and Certs", "CA_Test", "NCA", "nca_gost2022_test.cer"),
	}
}

// CRLs — CRL тестового УЦ НУЦ 2022.
func CRLs() []string {
	return []string{Path("pkisdk", "nca_gost2022_test.crl")}
}

// P12 — единственный ключ юрлица в каталоге SDK: role — «Первый руководитель»,
// «Сотрудник с правом подписи», «Сотрудник организации»; state — valid или revoke.
func P12(t testing.TB, role, state string) string {
	t.Helper()
	m, err := filepath.Glob(Path("pkisdk", "Keys and Certs", "Gost2015", "2026.05.08-2027.05.07", "Юридическое лицо", role, state, "*.p12"))
	if err != nil || len(m) != 1 {
		t.Fatalf("testpki: want one .p12 for %s/%s, got %v (%v)", role, state, m, err)
	}
	return m[0]
}

// Sign подписывает data ключом из p12 через KalkanCrypt: присоединённая CMS в base64,
// как createCAdESFromBase64 в NCALayer.
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
