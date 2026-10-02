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

// Verifier — проверка CMS для аттестатора. KalkanCrypt проверяет подпись, цепочку и отзыв
// по CRL; кроме того, AuthorityKeyId подписанта должен совпасть с SubjectKeyId одного из УЦ
// из конфига: KalkanCrypt строит цепочки и по системному хранилищу (/etc/ssl/certs), а печать
// ставят только сертификаты настроенного УЦ НУЦ.
type Verifier struct {
	crls      []string
	issuerIDs [][]byte
}

// NewVerifier загружает УЦ в KalkanCrypt (самоподписанный — как корневой, остальные — как
// промежуточные) и запоминает их SubjectKeyId. Init вызывается раньше.
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
		v.issuerIDs = append(v.issuerIDs, ca.SubjectKeyId)
	}
	return v, nil
}

// Verify проверяет CMS (base64) и возвращает подписанные данные и сертификат подписанта (DER).
// Ошибки: ErrBadSignature, ErrRevoked или *Error.
func (v *Verifier) Verify(cmsB64 string) (data, certDER []byte, err error) {
	data, certDER, err = VerifyCMS(cmsB64)
	if err != nil {
		return nil, nil, err
	}
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return nil, nil, &Error{Op: "parse signer certificate"}
	}
	if !slices.ContainsFunc(v.issuerIDs, func(id []byte) bool { return bytes.Equal(id, cert.AuthorityKeyId) }) {
		return nil, nil, fmt.Errorf("%w: issuer is not a configured NCA CA", ErrBadSignature)
	}
	for _, crl := range v.crls {
		if err := CheckCRL(certDER, crl); err != nil {
			return nil, nil, err
		}
	}
	return data, certDER, nil
}
