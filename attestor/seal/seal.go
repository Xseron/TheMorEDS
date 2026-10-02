// Package seal собирает сообщение печати Mör (MOR-SEAL-V1) байт в байт как
// SealMessage::to_bytes в programs/mor-registry/src/seal_message.rs и считает адреса
// реестра, которые нужны аттестатору.
package seal

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"unicode/utf8"

	"filippo.io/edwards25519"
)

// Tag — первые байты сообщения печати.
const Tag = "MOR-SEAL-V1"

// Kind — тип адреса (AddressKind в программе).
type Kind uint8

const (
	Wallet  Kind = 0
	Program Kind = 1
	Mint    Kind = 2
)

// Значения enum-ов программы: уровень доверия и тип субъекта.
const (
	TrustAttestor  uint8 = 0
	TrustTrustless uint8 = 1
	LegalEntity    uint8 = 0
)

// MaxNameLen — лимит названия в байтах UTF-8, как в программе.
const MaxNameLen = 128

var ErrName = errors.New("seal: name must be 1..128 bytes of valid UTF-8")

// Message — поля сообщения печати в порядке раскладки.
type Message struct {
	Program        [32]byte
	Address        [32]byte
	Kind           Kind
	Controller     [32]byte
	TrustLevel     uint8
	TrustService   [32]byte
	Certificate    [32]byte // нули для аттестатора
	Jurisdiction   [2]byte
	SubjectType    uint8
	IdentifierHash [32]byte
	ExpiresAt      int64
	SignDeadline   int64
	Name           string
}

// Bytes — подписываемые байты; длина названия — в байтах, не в символах.
func (m *Message) Bytes() ([]byte, error) {
	if len(m.Name) < 1 || len(m.Name) > MaxNameLen || !utf8.ValidString(m.Name) {
		return nil, ErrName
	}
	out := make([]byte, 0, 225+len(m.Name))
	out = append(out, Tag...)
	out = append(out, m.Program[:]...)
	out = append(out, m.Address[:]...)
	out = append(out, byte(m.Kind))
	out = append(out, m.Controller[:]...)
	out = append(out, m.TrustLevel)
	out = append(out, m.TrustService[:]...)
	out = append(out, m.Certificate[:]...)
	out = append(out, m.Jurisdiction[:]...)
	out = append(out, m.SubjectType)
	out = append(out, m.IdentifierHash[:]...)
	out = binary.LittleEndian.AppendUint64(out, uint64(m.ExpiresAt))
	out = binary.LittleEndian.AppendUint64(out, uint64(m.SignDeadline))
	out = append(out, byte(len(m.Name)))
	out = append(out, m.Name...)
	return out, nil
}

// IdentifierHash — sha256(salt ‖ jurisdiction ‖ identifier), как identifier_hash в программе.
func IdentifierHash(salt [32]byte, jurisdiction [2]byte, identifier string) [32]byte {
	h := sha256.New()
	h.Write(salt[:])
	h.Write(jurisdiction[:])
	h.Write([]byte(identifier))
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// FindProgramAddress — как Pubkey::find_program_address: первый bump от 255 вниз, при котором
// sha256(seeds ‖ bump ‖ program ‖ "ProgramDerivedAddress") не является точкой ed25519.
func FindProgramAddress(seeds [][]byte, program [32]byte) ([32]byte, uint8, error) {
	for bump := 255; bump >= 0; bump-- {
		h := sha256.New()
		for _, s := range seeds {
			h.Write(s)
		}
		h.Write([]byte{byte(bump)})
		h.Write(program[:])
		h.Write([]byte("ProgramDerivedAddress"))
		var addr [32]byte
		copy(addr[:], h.Sum(nil))
		if _, err := new(edwards25519.Point).SetBytes(addr[:]); err != nil {
			return addr, uint8(bump), nil
		}
	}
	return [32]byte{}, 0, errors.New("seal: no viable bump")
}

// TrustServicePDA — PDA TrustService аттестатора в реестре: ["trust", sha256(pubkey)].
func TrustServicePDA(program [32]byte, attestor ed25519.PublicKey) ([32]byte, error) {
	spki := sha256.Sum256(attestor)
	addr, _, err := FindProgramAddress([][]byte{[]byte("trust"), spki[:]}, program)
	return addr, err
}

// LoadKeypair читает ключ в формате keypair.json Solana: JSON-массив 64 байт (seed ‖ pubkey).
func LoadKeypair(path string) (ed25519.PrivateKey, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var nums []int
	if err := json.Unmarshal(raw, &nums); err != nil || len(nums) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("seal: %s is not a 64-byte Solana keypair", path)
	}
	b := make([]byte, len(nums))
	for i, n := range nums {
		if n < 0 || n > 255 {
			return nil, fmt.Errorf("seal: %s is not a 64-byte Solana keypair", path)
		}
		b[i] = byte(n)
	}
	key := ed25519.NewKeyFromSeed(b[:ed25519.SeedSize])
	if !bytes.Equal(key[ed25519.SeedSize:], b[ed25519.SeedSize:]) {
		return nil, fmt.Errorf("seal: %s: public key does not match the seed", path)
	}
	return key, nil
}
