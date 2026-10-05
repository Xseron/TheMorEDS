// Package server - HTTP API аттестатора. Ничего не хранит, а в лог пишет только результат,
// адрес и код ошибки: ни названия, ни БИН, ни полей сертификата
package server

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/mr-tron/base58"

	"mor/attestor/kalkan"
	"mor/attestor/policy"
	"mor/attestor/request"
	"mor/attestor/seal"
)

// Verifier отдаёт ошибки kalkan.ErrBadSignature, kalkan.ErrRevoked или *kalkan.Error
type Verifier interface {
	Verify(cmsB64 string) (data, certDER []byte, err error)
}

type Config struct {
	Verifier   Verifier
	Key        ed25519.PrivateKey // его TrustService должен быть зарегистрирован в реестре
	Program    [32]byte
	CORSOrigin string           // пусто = CORS выключен
	Now        func() time.Time // nil = time.Now
}

// DeadlineWindow в секундах: насколько далеко в будущем может быть deadline запроса
const DeadlineWindow = 900

const maxBody = 64 << 10

var kz = [2]byte{'K', 'Z'}

type Response struct {
	Message        string `json:"message"`   // base64
	Signature      string `json:"signature"` // base64, Ed25519
	Attestor       string `json:"attestor"`  // base58
	TrustService   string `json:"trustService"`
	Name           string `json:"name"`
	BIN            string `json:"bin"`
	Salt           string `json:"salt"` // hex, хранит владелец адреса
	IdentifierHash string `json:"identifierHash"`
	ExpiresAt      int64  `json:"expiresAt"`
	SignDeadline   int64  `json:"signDeadline"`
}

type Info struct {
	Attestor     string `json:"attestor"`
	TrustService string `json:"trustService"`
	Program      string `json:"program"`
}

type apiError struct {
	status  int
	cause   error  // только для лога, без персональных данных и полей сертификата
	Code    string `json:"error"`
	Message string `json:"message"`
}

func (e *apiError) Error() string { return e.Code }

func fail(status int, code, msg string, cause error) error {
	return &apiError{status: status, cause: cause, Code: code, Message: msg}
}

var deniedMessages = map[string]string{
	policy.CertNotValidNow: "signer certificate is not valid now",
	policy.NotLegalEntity:  "not a legal-entity certificate",
	policy.RoleNotAllowed:  "only the first head or an employee with signing right may seal",
	policy.NoBIN:           "certificate has no OU=BIN with 12 digits",
	policy.NoOrgName:       "certificate has no organization name (O, 1..128 bytes of UTF-8)",
}

type server struct {
	cfg          Config
	attestor     ed25519.PublicKey
	trustService [32]byte
}

func New(cfg Config) (http.Handler, error) {
	if cfg.Verifier == nil || len(cfg.Key) != ed25519.PrivateKeySize {
		return nil, errors.New("server: Verifier and an Ed25519 attestor key are required")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	pub := cfg.Key.Public().(ed25519.PublicKey)
	ts, err := seal.TrustServicePDA(cfg.Program, pub)
	if err != nil {
		return nil, err
	}
	s := &server{cfg: cfg, attestor: pub, trustService: ts}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/attest", s.attest)
	mux.HandleFunc("GET /v1/info", s.info)
	return s.cors(mux), nil
}

func (s *server) info(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, Info{
		Attestor:     base58.Encode(s.attestor),
		TrustService: base58.Encode(s.trustService[:]),
		Program:      base58.Encode(s.cfg.Program[:]),
	})
}

func (s *server) attest(w http.ResponseWriter, r *http.Request) {
	resp, addr, err := s.process(w, r)
	if err == nil {
		log.Printf("attest ok address=%s", addr)
		writeJSON(w, http.StatusOK, resp)
		return
	}
	var ae *apiError
	if !errors.As(err, &ae) {
		ae = &apiError{status: http.StatusInternalServerError, cause: err, Code: "kalkan_error",
			Message: "internal error"}
	}
	if ae.cause != nil {
		log.Printf("attest %s address=%s: %v", ae.Code, addr, ae.cause)
	} else {
		log.Printf("attest %s address=%s", ae.Code, addr)
	}
	writeJSON(w, ae.status, ae)
}

// вторым значением отдаёт адрес из запроса, он нужен только для лога
func (s *server) process(w http.ResponseWriter, r *http.Request) (Response, string, error) {
	var body struct {
		CMS string `json:"cms"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody)).Decode(&body); err != nil || body.CMS == "" {
		return Response{}, "", fail(http.StatusBadRequest, "bad_json", `body must be {"cms": "<base64>"}, at most 64 KiB`, nil)
	}
	// NCALayer и KalkanCrypt бывает переносят base64 по строкам
	cms := strings.Join(strings.Fields(body.CMS), "")
	if _, err := base64.StdEncoding.DecodeString(cms); err != nil {
		return Response{}, "", fail(http.StatusBadRequest, "bad_base64", "cms is not standard base64", nil)
	}

	data, certDER, err := s.cfg.Verifier.Verify(cms)
	switch {
	case errors.Is(err, kalkan.ErrBadSignature):
		return Response{}, "", fail(http.StatusUnauthorized, "bad_signature", "CMS signature or NCA certificate chain is invalid", err)
	case errors.Is(err, kalkan.ErrRevoked):
		return Response{}, "", fail(http.StatusForbidden, "revoked", "signer certificate is revoked (NCA CRL)", err)
	case err != nil:
		return Response{}, "", err
	}
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return Response{}, "", fmt.Errorf("parse signer certificate: %w", err)
	}

	now := s.cfg.Now()
	subject, err := policy.Check(policy.FromCertificate(cert), now)
	var denied *policy.Denied
	if errors.As(err, &denied) {
		return Response{}, "", fail(http.StatusForbidden, denied.Code, deniedMessages[denied.Code], nil)
	}
	if err != nil {
		return Response{}, "", err
	}

	req, err := request.Parse(data)
	if err != nil {
		return Response{}, "", fail(http.StatusUnprocessableEntity, "bad_request_text", err.Error(), nil)
	}
	addr := base58.Encode(req.Address[:])
	unix := now.Unix()
	switch {
	case req.Program != s.cfg.Program:
		return Response{}, addr, fail(http.StatusUnprocessableEntity, "wrong_program", "request is for another registry program", nil)
	case req.Deadline < unix || req.Deadline > unix+DeadlineWindow:
		return Response{}, addr, fail(http.StatusUnprocessableEntity, "deadline_out_of_window",
			fmt.Sprintf("deadline must be between now and now+%d seconds", DeadlineWindow), nil)
	case req.Expires <= unix:
		return Response{}, addr, fail(http.StatusUnprocessableEntity, "expires_in_past", "expires must be in the future", nil)
	}
	// печать не должна пережить сертификат подписанта
	expiresAt := min(req.Expires, subject.NotAfter.Unix())

	var salt [32]byte
	if _, err := rand.Read(salt[:]); err != nil {
		return Response{}, addr, err
	}
	ih := seal.IdentifierHash(salt, kz, subject.BIN)
	m := seal.Message{
		Program: s.cfg.Program, Address: req.Address, Kind: req.Kind, Controller: req.Controller,
		TrustLevel: seal.TrustAttestor, TrustService: s.trustService, Jurisdiction: kz,
		SubjectType: seal.LegalEntity, IdentifierHash: ih, ExpiresAt: expiresAt,
		SignDeadline: req.Deadline, Name: subject.Name,
	}
	msg, err := m.Bytes()
	if err != nil {
		return Response{}, addr, err
	}
	return Response{
		Message:        base64.StdEncoding.EncodeToString(msg),
		Signature:      base64.StdEncoding.EncodeToString(ed25519.Sign(s.cfg.Key, msg)),
		Attestor:       base58.Encode(s.attestor),
		TrustService:   base58.Encode(s.trustService[:]),
		Name:           subject.Name,
		BIN:            subject.BIN,
		Salt:           hex.EncodeToString(salt[:]),
		IdentifierHash: hex.EncodeToString(ih[:]),
		ExpiresAt:      expiresAt,
		SignDeadline:   req.Deadline,
	}, addr, nil
}

func (s *server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o := s.cfg.CORSOrigin; o != "" && r.Header.Get("Origin") == o {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Vary", "Origin")
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
