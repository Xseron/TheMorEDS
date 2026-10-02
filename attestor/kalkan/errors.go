// Package kalkan — обёртка над KalkanCrypt, сертифицированным СКЗИ НУЦ РК, через cgo.
// Вся криптография аттестатора идёт через неё: проверка CMS, цепочки до УЦ НУЦ и отзыва
// по CRL, а также подпись в dev-команде и тестах. Код с cgo собирается только с тегом
// kalkan (нужен SDK НУЦ в pkisdk/); этот файл — без тега, чтобы ошибки были видны
// пакетам, которые собираются без SDK.
//
// Итог спайка: работает сертифицированная KalkanCrypt 2.0.2 (2.0.14 ведёт себя так же).
// Библиотека оставляет неопределёнными функции OpenSSL (SRP_*, COMP_*, CT_*), поэтому
// dlopen идёт с RTLD_LAZY. Доверенные корни она берёт только из системного хранилища
// (/etc/ssl/certs/ca-certificates.crt; SDK: ca-certs_new/test2022.zip, install_test.sh):
// без них SignCMS падает с 0x08f00042, а LoadCA одна не помогает. Флаги: KC_SIGN_CMS |
// KC_IN_BASE64 (| KC_OUT_BASE64 для данных).
//
// Что проверяет каждый вызов (проверено на испорченной подписи, подмене sid, двух
// подписантах и сертификате с DN и AuthorityKeyId УЦ НУЦ, подписанном чужим ключом):
// VerifyData отвечает rv ≠ 0, если содержимое не сходится с хэшем в подписанных атрибутах
// или signingCertificateV2 — с сертификатом; неверное значение подписи единственного
// подписанта даёт rv = 0, и его итог виден только в outVerifyInfo (строка «Verify - OK»);
// цепочку и срок сертификата VerifyData не проверяет. KC_GetCertFromCMS отдаёт сертификат
// подписанта по sid SignerInfo номер N (с 1). X509ValidateCertificate с KC_USE_CRL проверяет
// цепочку до корня с подписями УЦ, срок действия и отзыв (код KCR_CERT_STATUS_REVOKED);
// с KC_USE_NOTHING подпись издателя не проверяется. KC_USE_CRL отвергает и просроченный CRL
// (0x08f0005d, это *Error, HTTP 500), а CheckCRL нужно вызывать только после проверки
// издателя: на самоподписанном сертификате без AuthorityKeyId X509ValidateCertificate
// после LoadCA падает с SIGSEGV.
package kalkan

import (
	"errors"
	"fmt"
)

var (
	// ErrBadSignature — CMS отвергнута: KalkanCrypt не подтвердила значение подписи, хэш
	// содержимого или signingCertificateV2 (VerifyData); подписантов не ровно один; издатель
	// сертификата не из конфига; X509ValidateCertificate отвергла цепочку, подпись УЦ
	// или срок действия сертификата.
	ErrBadSignature = errors.New("kalkan: CMS signature or certificate chain is invalid")
	// ErrRevoked — сертификат подписанта есть в CRL НУЦ.
	ErrRevoked = errors.New("kalkan: signer certificate is revoked")
)

// Error — сбой самой библиотеки или неожиданный ответ. Error() содержит только операцию
// и код: текст KalkanCrypt (Msg) может включать поля сертификата, поэтому в лог он не идёт.
// Msg заполняется только для Init, LoadCA, LoadKeyStore и SignCMS; ошибки VerifyCMS
// и CheckCRL его не несут (в тексте имя и ИИН подписанта).
type Error struct {
	Op   string
	Code uint32
	Msg  string
}

func (e *Error) Error() string { return fmt.Sprintf("kalkan %s: 0x%08x", e.Op, e.Code) }

// Message — текст ошибки KalkanCrypt для диагностики в dev-команде и тестах.
func Message(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Msg
	}
	return ""
}
