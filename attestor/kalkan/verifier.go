//go:build kalkan

package kalkan

import (
	"bytes"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"slices"
)

// Verifier — проверка CMS для аттестатора. Подпись, цепочку с подписями УЦ, срок и отзыв
// проверяет KalkanCrypt (VerifyCMS, CheckCRL); crypto/x509 только читает поля сертификата.
// Кроме того, издатель подписанта — один из УЦ из конфига: AuthorityKeyId равен его
// SubjectKeyId, а Issuer — его Subject (байт в байт), и сертификат не самоизданный.
// KalkanCrypt строит цепочки и по системному хранилищу (/etc/ssl/certs), а печать ставят
// только сертификаты настроенного УЦ НУЦ. Заодно в X509ValidateCertificate не попадают
// сертификаты чужих издателей: на самоподписанном сертификате без AuthorityKeyId после LoadCA
// она падает (SIGSEGV), а на самоподписанном с AuthorityKeyId УЦ НУЦ отвечает кодом ошибки
// загрузки CRL, а не отказом сертификату.
type Verifier struct {
	crls    []string
	issuers []issuer
}

type issuer struct{ keyID, subject []byte }

// NewVerifier загружает УЦ в KalkanCrypt (самоподписанный — как корневой, остальные — как
// промежуточные) и запоминает их SubjectKeyId и Subject. Init вызывается раньше.
func NewVerifier(caPaths, crlPaths []string) (*Verifier, error) {
	if len(crlPaths) == 0 {
		return nil, errors.New("kalkan: at least one CRL is required")
	}
	v := &Verifier{crls: crlPaths}
	for _, path := range caPaths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		der, err := decodeCert(raw)
		if err != nil {
			return nil, fmt.Errorf("kalkan: CA %s: %w", path, err)
		}
		ca, err := x509.ParseCertificate(der)
		if err != nil {
			return nil, fmt.Errorf("kalkan: CA %s: %w", path, err)
		}
		if len(ca.SubjectKeyId) == 0 {
			return nil, fmt.Errorf("kalkan: CA %s has no SubjectKeyId", path)
		}
		if err := LoadCA(path, bytes.Equal(ca.RawSubject, ca.RawIssuer)); err != nil {
			return nil, err
		}
		v.issuers = append(v.issuers, issuer{keyID: ca.SubjectKeyId, subject: ca.RawSubject})
	}
	return v, nil
}

// Verify проверяет присоединённую CMS (base64) и возвращает подписанные данные и сертификат
// подписанта (DER). Шаги: VerifyCMS — один подписант, значение подписи, хэш содержимого;
// привязка к УЦ из конфига; для каждого CRL — CheckCRL: цепочка с подписями УЦ, срок, отзыв.
//
// Ошибки: ErrBadSignature, ErrRevoked или *Error. ErrBadSignature часто обёрнута вместе
// с *Error (fmt.Errorf("%w: %w", ErrBadSignature, e)), и тогда errors.As(err, &kalkanErr)
// тоже истинно: сначала проверять errors.Is(err, ErrBadSignature), потом errors.As.
func (v *Verifier) Verify(cmsB64 string) (data, certDER []byte, err error) {
	data, certDER, err = VerifyCMS(cmsB64)
	if err != nil {
		return nil, nil, err
	}
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return nil, nil, &Error{Op: "parse signer certificate"}
	}
	selfIssued := bytes.Equal(cert.RawIssuer, cert.RawSubject)
	if selfIssued || !slices.ContainsFunc(v.issuers, func(ca issuer) bool {
		return bytes.Equal(ca.keyID, cert.AuthorityKeyId) && bytes.Equal(ca.subject, cert.RawIssuer)
	}) {
		return nil, nil, fmt.Errorf("%w: issuer is not a configured NCA CA", ErrBadSignature)
	}
	for _, crl := range v.crls {
		if err := CheckCRL(certDER, crl); err != nil {
			return nil, nil, err
		}
	}
	return data, certDER, nil
}
