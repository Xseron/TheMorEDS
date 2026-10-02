package request

import (
	"errors"
	"strings"
	"testing"

	"github.com/mr-tron/base58"

	"mor/attestor/seal"
)

var validLines = []string{
	"MOR-SEAL-REQUEST-V1",
	"program: CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP",
	"address: Bp75o5N39Zs2Qz7xseSSHVEKT8yAw8YEVxTQ48ZBeALw",
	"kind: wallet",
	"controller: Bp75o5N39Zs2Qz7xseSSHVEKT8yAw8YEVxTQ48ZBeALw",
	"expires: 1790000000",
	"deadline: 1775000600",
}

func TestParse(t *testing.T) {
	valid := strings.Join(validLines, "\n")
	r, err := Parse([]byte(valid))
	if err != nil {
		t.Fatal(err)
	}
	if r.Kind != seal.Wallet || r.Expires != 1790000000 || r.Deadline != 1775000600 ||
		base58.Encode(r.Address[:]) != "Bp75o5N39Zs2Qz7xseSSHVEKT8yAw8YEVxTQ48ZBeALw" || r.Controller != r.Address {
		t.Fatalf("parsed %+v", r)
	}
	if r.Text() != valid {
		t.Fatalf("Text() is not canonical:\n%s", r.Text())
	}

	swapped := append([]string{}, validLines...)
	swapped[1], swapped[2] = swapped[2], swapped[1]
	bad := map[string]string{
		"extra line":           valid + "\nname: x",
		"trailing newline":     valid + "\n",
		"swapped keys":         strings.Join(swapped, "\n"),
		"unknown kind":         strings.Replace(valid, "kind: wallet", "kind: token", 1),
		"expires not a number": strings.Replace(valid, "expires: 1790000000", "expires: 17x", 1),
		"leading zero":         strings.Replace(valid, "expires: 1790000000", "expires: 01790000000", 1),
		"trailing space":       strings.Replace(valid, "kind: wallet", "kind: wallet ", 1),
		"short address":        strings.Replace(valid, "address: Bp75o5N39Zs2Qz7xseSSHVEKT8yAw8YEVxTQ48ZBeALw", "address: 1111", 1),
		"CRLF":                 strings.ReplaceAll(valid, "\n", "\r\n"),
		"BOM":                  "\ufeff" + valid,
	}
	for name, text := range bad {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(text)); !errors.Is(err, ErrBadText) {
				t.Fatalf("got %v, want ErrBadText", err)
			}
		})
	}
}
