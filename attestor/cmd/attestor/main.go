//go:build kalkan

// Команда attestor: serve поднимает аттестатор, sign-request подписывает запрос тестовым ключом
// вместо NCALayer. Запускать из корня репозитория
package main

import (
	"crypto/ed25519"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/mr-tron/base58"

	"mor/attestor/kalkan"
	"mor/attestor/request"
	"mor/attestor/seal"
	"mor/attestor/server"
)

// по умолчанию тестовая иерархия НУЦ из SDK, pkisdk/ в git не лежит
const (
	testRoot     = "pkisdk/Keys and Certs/CA_Test/ROOT/root_test_gost_2022.cer"
	testNCA      = "pkisdk/Keys and Certs/CA_Test/NCA/nca_gost2022_test.cer"
	testCRL      = "pkisdk/nca_gost2022_test.crl"
	certifiedLib = "pkisdk/C/Linux/C/libs/v2.0.2 (Сертифицированная версия)/libkalkancryptwr-64.so.2.0.2"
	testKey      = "DzEKM1bBSwg199FtSeqmeo7x2HD3kaCn7XBR7FvQcDmy" // fixtures/keys/attestor.json
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve(os.Args[2:])
	case "sign-request":
		err = signRequest(os.Args[2:])
	default:
		usage()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "attestor:", err)
		if msg := kalkan.Message(err); msg != "" {
			fmt.Fprintln(os.Stderr, "KalkanCrypt:", msg)
		}
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: attestor serve [flags] | attestor sign-request --p12 FILE --password PW --request FILE")
	os.Exit(2)
}

type list []string

func (l *list) String() string     { return strings.Join(*l, ",") }
func (l *list) Set(v string) error { *l = append(*l, v); return nil }

func libFlag(fs *flag.FlagSet) *string {
	def := os.Getenv("KALKAN_LIB")
	if def == "" {
		def = certifiedLib
	}
	return fs.String("kalkan-lib", def, "path to libkalkancryptwr-64.so (env KALKAN_LIB)")
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	listen := fs.String("listen", "127.0.0.1:8787", "address to listen on")
	keyPath := fs.String("key", "fixtures/keys/attestor.json", "attestor Ed25519 keypair (Solana keypair.json)")
	programID := fs.String("program", "CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP", "registry program ID")
	corsOrigin := fs.String("cors-origin", "", "page origin allowed by CORS (empty: CORS off)")
	lib := libFlag(fs)
	var cas, crls list
	fs.Var(&cas, "ca", "trusted NCA CA certificate, repeatable (default: NCA test root and intermediate)")
	fs.Var(&crls, "crl", "NCA CRL file, repeatable (default: NCA test CRL)")
	fs.Parse(args)
	if len(cas) == 0 {
		cas = list{testRoot, testNCA}
	}
	if len(crls) == 0 {
		crls = list{testCRL}
	}

	key, err := seal.LoadKeypair(*keyPath)
	if err != nil {
		return err
	}
	raw, err := base58.Decode(*programID)
	if err != nil || len(raw) != 32 {
		return fmt.Errorf("--program %q is not a base58 program ID", *programID)
	}
	var program [32]byte
	copy(program[:], raw)

	if err := kalkan.Init(*lib); err != nil {
		return err
	}
	v, err := kalkan.NewVerifier(cas, crls)
	if err != nil {
		return err
	}
	h, err := server.New(server.Config{Verifier: v, Key: key, Program: program, CORSOrigin: *corsOrigin})
	if err != nil {
		return err
	}
	pub := base58.Encode(key.Public().(ed25519.PublicKey))
	if pub == testKey {
		log.Printf("WARNING: test attestor key from fixtures/ — it is public in the repository, devnet demo only")
	}
	log.Printf("attestor %s, registry %s, listening on http://%s", pub, *programID, *listen)
	srv := &http.Server{Addr: *listen, Handler: h, ReadHeaderTimeout: 10 * time.Second}
	return srv.ListenAndServe()
}

func signRequest(args []string) error {
	fs := flag.NewFlagSet("sign-request", flag.ExitOnError)
	p12 := fs.String("p12", "", "PKCS#12 key file (NCA test key)")
	password := fs.String("password", "", "key password")
	reqPath := fs.String("request", "", "request text file")
	lib := libFlag(fs)
	fs.Parse(args)
	if *p12 == "" || *reqPath == "" {
		return errors.New("--p12 and --request are required")
	}
	text, err := os.ReadFile(*reqPath)
	if err != nil {
		return err
	}
	// битый запрос аттестатор всё равно отклонит
	if _, err := request.Parse(text); err != nil {
		return err
	}
	if err := kalkan.Init(*lib); err != nil {
		return err
	}
	if err := kalkan.LoadKeyStore(*p12, *password); err != nil {
		return err
	}
	cms, err := kalkan.SignCMS(text)
	if err != nil {
		return err
	}
	fmt.Println(cms)
	return nil
}
