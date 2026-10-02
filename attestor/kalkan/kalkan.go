//go:build kalkan

package kalkan

/*
#cgo CFLAGS: -I${SRCDIR}/../../pkisdk/C/Linux/C/test
#cgo LDFLAGS: -ldl
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include "KalkanCrypt.h"

static stKCFunctionsType *kc;

static int kc_open(const char *path) {
	// Fallback (spike): 2.0.2 leaves OpenSSL SRP_*, COMP_*, CT_* functions undefined (they are
	// not used for CMS), so eager binding fails with "undefined symbol: SRP_Calc_A".
	// Bind lazily.
	void *h = dlopen(path, RTLD_LAZY | RTLD_GLOBAL);
	if (!h) return 1;
	int (*list)(stKCFunctionsType **) = (int (*)(stKCFunctionsType **))dlsym(h, "KC_GetFunctionList");
	if (!list) return 2;
	list(&kc);
	return kc ? 0 : 3;
}

static const char *kc_dlerror(void) { return dlerror(); }

static unsigned long kc_init(void) { return kc->KC_Init(); }

static unsigned long kc_last_error(char *buf, int *len) { return kc->KC_GetLastErrorString(buf, len); }

static unsigned long kc_load_ca(char *path, int type) { return kc->X509LoadCertificateFromFile(path, type); }

static unsigned long kc_load_p12(char *path, int pathLen, char *password, int passwordLen) {
	return kc->KC_LoadKeyStore(KCST_PKCS12, password, passwordLen, path, pathLen, "");
}

static unsigned long kc_sign(int flags, char *in, int inLen, unsigned char *out, int *outLen) {
	unsigned char none[1] = {0};
	return kc->SignData("", flags, in, inLen, none, 0, out, outLen);
}

static unsigned long kc_verify(int flags, char *cms, int cmsLen, char *data, int *dataLen,
		char *info, int *infoLen, char *cert, int *certLen) {
	return kc->VerifyData("", flags, "", 0, (unsigned char *)cms, cmsLen, data, dataLen,
		info, infoLen, 0, cert, certLen);
}

// Fallback (spike): VerifyData returns an empty outCert for CMS here, so the signer
// certificate is taken from the CMS separately (signature number 1, as in the SDK test.cpp).
static unsigned long kc_cert_from_cms(char *cms, int cmsLen, char *cert, int *certLen) {
	return kc->KC_GetCertFromCMS(cms, cmsLen, 1, KC_SIGN_CMS | KC_IN_BASE64 | KC_OUT_PEM, cert, certLen);
}

static unsigned long kc_check_crl(char *cert, int certLen, char *crl, char *info, int *infoLen) {
	int ocspLen = 0;
	return kc->X509ValidateCertificate(cert, certLen, KC_USE_CRL, crl, 0, info, infoLen, 0, NULL, &ocspLen);
}
*/
import "C"

import (
	"bytes"
	"encoding/asn1"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"unsafe"
)

// Флаги проверены спайком: на входе присоединённая CMS в base64, подписанные данные
// на выходе — тоже base64 (двоичные данные не обрезаются на нулевом байте).
const (
	signFlags   = C.KC_SIGN_CMS | C.KC_IN_BASE64 | C.KC_OUT_BASE64
	verifyFlags = C.KC_SIGN_CMS | C.KC_IN_BASE64 | C.KC_IN2_BASE64 | C.KC_OUT_BASE64
	bufSize     = 64 << 10
)

// calls — очередь вызовов KalkanCrypt. Все они идут на одном OS-потоке: библиотека хранит
// текущий ключ и последнюю ошибку глобально (возможно, в памяти потока); заодно вызовы
// сериализуются — из нескольких горутин одновременно KalkanCrypt не вызывается.
var calls chan func()

func run(f func() error) error {
	if calls == nil {
		return errors.New("kalkan: Init was not called")
	}
	done := make(chan error, 1)
	calls <- func() { done <- f() }
	return <-done
}

// Init загружает библиотеку (dlopen) и вызывает KC_Init. Вызывается один раз на процесс;
// после неудачи очередь закрывается, чтобы следующие вызовы не ушли в неинициализированную
// библиотеку (kc == NULL), а вернули ошибку из run.
func Init(libPath string) error {
	if calls != nil {
		return errors.New("kalkan: already initialized")
	}
	calls = make(chan func())
	go func() {
		runtime.LockOSThread()
		for f := range calls {
			f()
		}
	}()
	err := run(func() error {
		p := C.CString(libPath)
		defer C.free(unsafe.Pointer(p))
		if C.kc_open(p) != 0 {
			return fmt.Errorf("kalkan: load %s: %s", libPath, C.GoString(C.kc_dlerror()))
		}
		if rv := C.kc_init(); rv != 0 {
			return lastError("init", rv)
		}
		return nil
	})
	if err != nil {
		close(calls)
		calls = nil
	}
	return err
}

// LoadCA делает сертификат УЦ из файла (DER или PEM) доверенным: root — корневой,
// иначе промежуточный.
func LoadCA(path string, root bool) error {
	typ := C.int(C.KC_CERT_INTERMEDIATE)
	if root {
		typ = C.KC_CERT_CA
	}
	return run(func() error {
		p := C.CString(path)
		defer C.free(unsafe.Pointer(p))
		if rv := C.kc_load_ca(p, typ); rv != 0 {
			return lastError("load CA", rv)
		}
		return nil
	})
}

// LoadKeyStore делает ключ из PKCS#12 текущим для SignCMS. Только тесты и dev-команда.
func LoadKeyStore(p12Path, password string) error {
	return run(func() error {
		path, pw := C.CString(p12Path), C.CString(password)
		defer C.free(unsafe.Pointer(path))
		defer C.free(unsafe.Pointer(pw))
		if rv := C.kc_load_p12(path, C.int(len(p12Path)), pw, C.int(len(password))); rv != 0 {
			return lastError("load key store", rv)
		}
		return nil
	})
}

// SignCMS подписывает data текущим ключом: присоединённая CMS (CAdES) в base64 без
// пробелов — то же, что createCAdESFromBase64 в NCALayer. Только тесты и dev-команда.
func SignCMS(data []byte) (string, error) {
	var cms string
	err := run(func() error {
		in := C.CString(base64.StdEncoding.EncodeToString(data))
		defer C.free(unsafe.Pointer(in))
		out := make([]byte, bufSize)
		n := C.int(len(out))
		if rv := C.kc_sign(signFlags, in, C.int(C.strlen(in)), (*C.uchar)(unsafe.Pointer(&out[0])), &n); rv != 0 {
			return lastError("sign", rv)
		}
		cms = strings.Join(strings.Fields(cstr(out, n)), "")
		return nil
	})
	return cms, err
}

// VerifyCMS проверяет присоединённую CMS (base64): подпись ГОСТ, срок сертификата и цепочку
// до доверенного УЦ. Возвращает подписанные данные и сертификат подписанта (DER).
func VerifyCMS(cmsB64 string) (data, certDER []byte, err error) {
	err = run(func() error {
		in := C.CString(cmsB64)
		defer C.free(unsafe.Pointer(in))
		outData, outInfo, outCert := make([]byte, bufSize), make([]byte, bufSize), make([]byte, bufSize)
		dataLen, infoLen, certLen := C.int(bufSize), C.int(bufSize), C.int(bufSize)
		rv := C.kc_verify(verifyFlags, in, C.int(len(cmsB64)), cbuf(outData), &dataLen,
			cbuf(outInfo), &infoLen, cbuf(outCert), &certLen)
		if rv != 0 {
			e := lastError("verify", rv)
			if libraryFailure(rv) {
				return e
			}
			return fmt.Errorf("%w: %w", ErrBadSignature, e)
		}
		var err error
		if data, err = base64.StdEncoding.DecodeString(strings.Join(strings.Fields(cstr(outData, dataLen)), "")); err != nil {
			return &Error{Op: "verify: signed data is not base64"}
		}
		certLen = C.int(bufSize)
		if rv := C.kc_cert_from_cms(in, C.int(len(cmsB64)), cbuf(outCert), &certLen); rv != 0 {
			return lastError("signer certificate", rv)
		}
		if certDER, err = decodeCert(outCert[:clamp(certLen)]); err != nil {
			return &Error{Op: "verify: signer certificate"}
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	return data, certDER, nil
}

// CheckCRL проверяет сертификат (DER) по файлу CRL: nil — не отозван, ErrRevoked — отозван.
func CheckCRL(certDER []byte, crlPath string) error {
	return run(func() error {
		cert := C.CString(string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})))
		crl := C.CString(crlPath)
		defer C.free(unsafe.Pointer(cert))
		defer C.free(unsafe.Pointer(crl))
		info := make([]byte, 8192)
		n := C.int(len(info))
		switch rv := C.kc_check_crl(cert, C.int(C.strlen(cert)), crl, cbuf(info), &n); rv {
		case 0:
			return nil
		case C.KCR_CERT_STATUS_REVOKED:
			return ErrRevoked
		default:
			return lastError("CRL", rv)
		}
	})
}

// libraryFailure — коды сбоев самой библиотеки, а не подписи: они дают kalkan_error,
// а не bad_signature.
func libraryFailure(rv C.ulong) bool {
	switch rv {
	case C.KCR_INIT_ERROR, C.KCR_MEMORY_ERROR, C.KCR_BUFFER_TOO_SMALL, C.KCR_INVALID_FLAG,
		C.KCR_INVALID_FLAGS, C.KCR_ENGINE_INITERR, C.KCR_LIBRARYNOTINITIALIZED,
		C.KCR_ENGINELOADERR, C.KCR_PARAM_ERROR:
		return true
	}
	return false
}

// lastError вызывается на потоке KalkanCrypt сразу после неудачного вызова.
func lastError(op string, rv C.ulong) *Error {
	buf := make([]byte, 4096)
	n := C.int(len(buf))
	C.kc_last_error(cbuf(buf), &n)
	return &Error{Op: op, Code: uint32(rv), Msg: cstr(buf, n)}
}

// decodeCert принимает сертификат в любом виде, который отдаёт KalkanCrypt или лежит
// в файле: DER (длина берётся из заголовка, хвост буфера отбрасывается), PEM или base64.
func decodeCert(b []byte) ([]byte, error) {
	if len(b) > 0 && b[0] == 0x30 {
		var v asn1.RawValue
		if _, err := asn1.Unmarshal(b, &v); err != nil {
			return nil, err
		}
		return v.FullBytes, nil
	}
	s := bytes.TrimRight(b, "\x00")
	if blk, _ := pem.Decode(s); blk != nil {
		return blk.Bytes, nil
	}
	return base64.StdEncoding.DecodeString(strings.Join(strings.Fields(string(s)), ""))
}

func cbuf(b []byte) *C.char { return (*C.char)(unsafe.Pointer(&b[0])) }

func clamp(n C.int) int {
	if n < 0 || int(n) > bufSize {
		return bufSize
	}
	return int(n)
}

// cstr — строка из буфера KalkanCrypt: не длиннее n и до первого нулевого байта.
func cstr(b []byte, n C.int) string {
	if int(n) >= 0 && int(n) < len(b) {
		b = b[:n]
	}
	if i := bytes.IndexByte(b, 0); i >= 0 {
		b = b[:i]
	}
	return string(b)
}
