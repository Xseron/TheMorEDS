package policy

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCheck(t *testing.T) {
	now := time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC)
	firstHead := Fields{
		EKU:           []string{OIDLegalEntity, OIDFirstHead},
		Organizations: []string{"ТОО «Ромашка»"},
		OrgUnits:      []string{"BIN123456789012"},
		NotBefore:     now.AddDate(0, -1, 0),
		NotAfter:      now.AddDate(1, 0, 0),
	}
	s, err := Check(firstHead, now)
	if err != nil {
		t.Fatal(err)
	}
	if s.Name != "ТОО «Ромашка»" || s.BIN != "123456789012" || !s.NotAfter.Equal(firstHead.NotAfter) {
		t.Fatalf("subject %+v", s)
	}

	with := func(mod func(*Fields)) Fields {
		f := firstHead
		mod(&f)
		return f
	}
	cases := []struct {
		name string
		f    Fields
		code string
	}{
		{"ordinary employee", with(func(f *Fields) { f.EKU = []string{OIDLegalEntity, "1.2.398.3.3.4.1.2.5"} }), RoleNotAllowed},
		{"no BIN", with(func(f *Fields) { f.OrgUnits = nil }), NoBIN},
		{"name not UTF-8", with(func(f *Fields) { f.Organizations = []string{"\xff"} }), NoOrgName},
		{"name over 128 bytes", with(func(f *Fields) { f.Organizations = []string{strings.Repeat("Ж", 65)} }), NoOrgName},
		{"two BIN", with(func(f *Fields) { f.OrgUnits = []string{"BIN123456789012", "BIN210987654321"} }), NoBIN},
		{"two O", with(func(f *Fields) { f.Organizations = []string{"ТОО «Ромашка»", "ТОО «Лютик»"} }), NoOrgName},
		{"no legal entity EKU", with(func(f *Fields) { f.EKU = []string{OIDFirstHead} }), NotLegalEntity},
	}
	// 64 буквы по 2 байта: ровно 128, ещё допустимо
	long := strings.Repeat("Ж", 64)
	if s, err := Check(with(func(f *Fields) { f.Organizations = []string{long} }), now); err != nil || s.Name != long {
		t.Fatalf("128-byte name: got %+v, %v", s, err)
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var d *Denied
			if _, err := Check(c.f, now); !errors.As(err, &d) || d.Code != c.code {
				t.Fatalf("got %v, want %s", err, c.code)
			}
		})
	}
}
