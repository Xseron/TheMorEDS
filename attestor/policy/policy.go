// Package policy решает по полям сертификата подписанта, может ли он запечатать адрес от
// имени юрлица. Читает только O, OU, EKU и сроки; ФИО и ИИН (CN, SN, GN, serialNumber)
// не трогает. Подпись и цепочку здесь не проверяют — это сделала KalkanCrypt.
package policy

import (
	"crypto/x509"
	"regexp"
	"slices"
	"time"
	"unicode/utf8"
)

// Роли НУЦ РК в extKeyUsage.
const (
	OIDLegalEntity     = "1.2.398.3.3.4.1.2"
	OIDFirstHead       = "1.2.398.3.3.4.1.2.1"
	OIDSigningEmployee = "1.2.398.3.3.4.1.2.2"
)

// Коды отказа — те же строки, что в ответе аттестатора.
const (
	CertNotValidNow = "cert_not_valid_now"
	NotLegalEntity  = "not_legal_entity"
	RoleNotAllowed  = "role_not_allowed"
	NoBIN           = "no_bin"
	NoOrgName       = "no_org_name"
)

const maxNameLen = 128 // как seal.MaxNameLen

// Denied — отказ политики; Code — код для ответа.
type Denied struct{ Code string }

func (d *Denied) Error() string { return "policy: " + d.Code }

// Fields — поля сертификата, которые смотрит политика.
type Fields struct {
	EKU           []string // OID через точку
	Organizations []string // значения O
	OrgUnits      []string // значения OU
	NotBefore     time.Time
	NotAfter      time.Time
}

func FromCertificate(c *x509.Certificate) Fields {
	f := Fields{
		Organizations: c.Subject.Organization,
		OrgUnits:      c.Subject.OrganizationalUnit,
		NotBefore:     c.NotBefore,
		NotAfter:      c.NotAfter,
	}
	for _, oid := range c.UnknownExtKeyUsage {
		f.EKU = append(f.EKU, oid.String())
	}
	return f
}

// Subject — кто стоит за подписью: название и БИН организации, конец сертификата.
type Subject struct {
	Name     string
	BIN      string
	NotAfter time.Time
}

var binRe = regexp.MustCompile(`^BIN([0-9]{12})$`)

func Check(f Fields, now time.Time) (Subject, error) {
	if now.Before(f.NotBefore) || now.After(f.NotAfter) {
		return Subject{}, &Denied{CertNotValidNow}
	}
	if !slices.Contains(f.EKU, OIDLegalEntity) {
		return Subject{}, &Denied{NotLegalEntity}
	}
	if !slices.Contains(f.EKU, OIDFirstHead) && !slices.Contains(f.EKU, OIDSigningEmployee) {
		return Subject{}, &Denied{RoleNotAllowed}
	}
	var bins []string
	for _, ou := range f.OrgUnits {
		if m := binRe.FindStringSubmatch(ou); m != nil {
			bins = append(bins, m[1])
		}
	}
	if len(bins) != 1 {
		return Subject{}, &Denied{NoBIN}
	}
	if len(f.Organizations) != 1 || !validName(f.Organizations[0]) {
		return Subject{}, &Denied{NoOrgName}
	}
	return Subject{Name: f.Organizations[0], BIN: bins[0], NotAfter: f.NotAfter}, nil
}

func validName(s string) bool {
	return s != "" && len(s) <= maxNameLen && utf8.ValidString(s)
}
