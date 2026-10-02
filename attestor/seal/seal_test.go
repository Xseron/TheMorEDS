package seal

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/mr-tron/base58"
)

// Эталон из спека аттестатора: входные данные Rust-теста layout_matches_spec_offsets.
const (
	referenceHex = "4d4f522d5345414c2d5631afe3ef75354d140f003334108037ea07df2cfdad47b65d62fa7a5d78f63d0fb0010101010101010101010101010101010101010101010101010101010101010102020202020202020202020202020202020202020202020202020202020202020201030303030303030303030303030303030303030303030303030303030303030304040404040404040404040404040404040404040404040404040404040404044b5a0005050505050505050505050505050505050505050505050505050505050505050807060504030201ffffffffffffffff19d0a2d09ed09e20c2abd0a0d0bed0bcd0b0d188d0bad0b0c2bb"
	referenceSHA = "41672e1455b594791f5bf302171b05f2de12063730d12a707bcc738a8b18213b"
	registryID   = "CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP"
)

func fill(b byte) (out [32]byte) {
	for i := range out {
		out[i] = b
	}
	return out
}

func TestReferenceVectors(t *testing.T) {
	var program [32]byte
	raw, err := base58.Decode(registryID)
	if err != nil || len(raw) != 32 {
		t.Fatal("registry ID", err)
	}
	copy(program[:], raw)

	m := Message{
		Program: program, Address: fill(1), Kind: Mint, Controller: fill(2),
		TrustLevel: TrustTrustless, TrustService: fill(3), Certificate: fill(4),
		Jurisdiction: [2]byte{'K', 'Z'}, SubjectType: LegalEntity, IdentifierHash: fill(5),
		ExpiresAt: 0x0102030405060708, SignDeadline: -1, Name: "ТОО «Ромашка»",
	}
	got, err := m.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	if h := hex.EncodeToString(got); h != referenceHex {
		t.Fatalf("message bytes\n got %s\nwant %s", h, referenceHex)
	}
	if sum := sha256.Sum256(got); hex.EncodeToString(sum[:]) != referenceSHA {
		t.Fatal("sha256 mismatch")
	}

	// PDA TrustService тестового аттестатора совпадает с зарегистрированным на devnet.
	key, err := LoadKeypair("../../fixtures/keys/attestor.json")
	if err != nil {
		t.Fatal(err)
	}
	pub := key.Public().(ed25519.PublicKey)
	if got := base58.Encode(pub); got != "DzEKM1bBSwg199FtSeqmeo7x2HD3kaCn7XBR7FvQcDmy" {
		t.Fatalf("attestor pubkey %s", got)
	}
	ts, err := TrustServicePDA(program, pub)
	if err != nil {
		t.Fatal(err)
	}
	if got := base58.Encode(ts[:]); got != "GfmdiooMadYsqzEG6bbC6tA7RjAyCMqdjfdRMMevEFnJ" {
		t.Fatalf("trust service PDA %s", got)
	}
	if bytes.Equal(ts[:], pub) {
		t.Fatal("PDA must differ from the key")
	}
}
