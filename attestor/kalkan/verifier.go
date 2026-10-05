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

// Verifier сверх KalkanCrypt требует, чтобы издатель был одним из УЦ из конфига: AuthorityKeyId
// равен его SubjectKeyId, Issuer его Subject байт в байт, сам сертификат не самоизданный. Цепочки
// KalkanCrypt строит и по /etc/ssl/certs, а печать ставят только сертификаты НУЦ. Заодно чужие
// сертификаты не доходят до X509ValidateCertificate: на самоподписанном без AuthorityKeyId она
// падает с SIGSEGV, а на самоподписанном с AuthorityKeyId УЦ НУЦ отвечает ошибкой загрузки CRL
// вместо отказа
type Verifier struct {
	crls    []string
	issuers []issuer
}

type issuer struct{ keyID, subject []byte }

// NewVerifier зовётся после Init
func NewVerifier(caPaths, crlPaths []string) (*Verifier, error) {
	if len(crlPaths) == 0 {
		return nil, errors.New("kalkan: at least one CRL is required")
	}
	// без файла CRL каждый запрос получал бы 500. Разобрать его x509.ParseRevocationList нельзя:
	// Go отвергает CRL НУЦ с "inner and outer signature algorithm identifiers don't match"
	for _, path := range crlPaths {
		if _, err := os.Stat(path); err != nil {
			return nil, fmt.Errorf("kalkan: CRL: %w", err)
		}
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

// Verify часто возвращает ErrBadSignature, обёрнутую вместе с *Error, и errors.As на ней тоже
// срабатывает. Поэтому сначала errors.Is(err, ErrBadSignature), потом errors.As
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
