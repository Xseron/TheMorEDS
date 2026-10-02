// Package request разбирает текст запроса на печать, который компания подписывает в
// NCALayer. Формат строгий: ровно эти строки в этом порядке, LF, без пробелов в конце
// строк и без завершающего перевода строки; любое отклонение — ErrBadText.
package request

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/mr-tron/base58"

	"mor/attestor/seal"
)

// Header — первая строка запроса.
const Header = "MOR-SEAL-REQUEST-V1"

var ErrBadText = errors.New("bad request text")

// Request — разобранный запрос. Название и БИН в нём нет: их берут из сертификата.
type Request struct {
	Program    [32]byte
	Address    [32]byte
	Kind       seal.Kind
	Controller [32]byte
	Expires    int64
	Deadline   int64
}

var keys = [...]string{"program", "address", "kind", "controller", "expires", "deadline"}

// kindNames — имена типов адреса по значению seal.Kind.
var kindNames = [...]string{seal.Wallet: "wallet", seal.Program: "program", seal.Mint: "mint"}

func Parse(text []byte) (Request, error) {
	lines := strings.Split(string(text), "\n")
	if len(lines) != len(keys)+1 || lines[0] != Header {
		return Request{}, fmt.Errorf("%w: want %q and %d lines \"key: value\", LF, no trailing newline", ErrBadText, Header, len(keys))
	}
	var v [len(keys)]string
	for i, k := range keys {
		val, ok := strings.CutPrefix(lines[i+1], k+": ")
		if !ok || val == "" || strings.ContainsAny(val, " \t\r") {
			return Request{}, fmt.Errorf("%w: line %d must be %q", ErrBadText, i+2, k+": <value>")
		}
		v[i] = val
	}
	var r Request
	var err error
	if r.Program, err = pubkey(v[0]); err != nil {
		return Request{}, err
	}
	if r.Address, err = pubkey(v[1]); err != nil {
		return Request{}, err
	}
	if r.Kind, err = kind(v[2]); err != nil {
		return Request{}, err
	}
	if r.Controller, err = pubkey(v[3]); err != nil {
		return Request{}, err
	}
	if r.Expires, err = unix(v[4]); err != nil {
		return Request{}, err
	}
	if r.Deadline, err = unix(v[5]); err != nil {
		return Request{}, err
	}
	return r, nil
}

// Text — канонический текст запроса.
func (r Request) Text() string {
	return strings.Join([]string{
		Header,
		"program: " + base58.Encode(r.Program[:]),
		"address: " + base58.Encode(r.Address[:]),
		"kind: " + kindNames[r.Kind],
		"controller: " + base58.Encode(r.Controller[:]),
		"expires: " + strconv.FormatInt(r.Expires, 10),
		"deadline: " + strconv.FormatInt(r.Deadline, 10),
	}, "\n")
}

func pubkey(s string) ([32]byte, error) {
	var out [32]byte
	b, err := base58.Decode(s)
	if err != nil || len(b) != 32 || base58.Encode(b) != s {
		return out, fmt.Errorf("%w: %q is not a 32-byte base58 address", ErrBadText, s)
	}
	copy(out[:], b)
	return out, nil
}

func kind(s string) (seal.Kind, error) {
	for k, name := range kindNames {
		if name == s {
			return seal.Kind(k), nil
		}
	}
	return 0, fmt.Errorf("%w: kind must be wallet, program or mint", ErrBadText)
}

// unix — десятичное число без знака «+», ведущих нулей и пробелов.
func unix(s string) (int64, error) {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || strconv.FormatInt(n, 10) != s {
		return 0, fmt.Errorf("%w: %q is not a decimal unix time", ErrBadText, s)
	}
	return n, nil
}
