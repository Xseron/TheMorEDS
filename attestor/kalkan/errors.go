// Package kalkan оборачивает KalkanCrypt (СКЗИ НУЦ РК) через cgo. Этот файл собирается без тега
// kalkan, чтобы ошибки были видны пакетам, собранным без SDK
//
// Работает сертифицированная 2.0.2, 2.0.14 ведёт себя так же. Доверенные корни библиотека берёт
// только из системного хранилища (/etc/ssl/certs/ca-certificates.crt, в SDK это
// ca-certs_new/test2022.zip и install_test.sh): без них SignCMS падает с 0x08f00042, и LoadCA
// тут не помогает
package kalkan

import (
	"errors"
	"fmt"
)

var (
	// ErrBadSignature заодно покрывает издателя не из конфига и больше одного подписанта
	ErrBadSignature = errors.New("kalkan: CMS signature or certificate chain is invalid")
	ErrRevoked      = errors.New("kalkan: signer certificate is revoked")
)

// Error означает сбой самой библиотеки. Msg не попадает в Error() и в лог, потому что в тексте
// KalkanCrypt бывают поля сертификата. У VerifyCMS и CheckCRL Msg всегда пустой
type Error struct {
	Op   string
	Code uint32
	Msg  string
}

func (e *Error) Error() string { return fmt.Sprintf("kalkan %s: 0x%08x", e.Op, e.Code) }

// Message нужен только dev-команде и тестам, в лог его не писать
func Message(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Msg
	}
	return ""
}
