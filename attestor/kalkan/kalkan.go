//go:build kalkan

package kalkan

/*
#cgo CFLAGS: -I${SRCDIR}/../../pkisdk/C/Linux/C/test
#cgo LDFLAGS: -ldl
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "KalkanCrypt.h"

static stKCFunctionsType *kc;
static char kc_open_error[512];

// NULL при успехе, иначе текст ошибки
//
// RTLD_LAZY: в 2.0.2 не определены SRP_*, COMP_*, CT_* из OpenSSL, и с RTLD_NOW dlopen падает
// на "undefined symbol: SRP_Calc_A". Для CMS и CRL они не нужны, но если библиотека всё же
// дёрнет такую функцию, процесс умрёт с symbol lookup error и Go это не поймает
// RTLD_GLOBAL: неразрешённые имена могут прицепиться к чужому OpenSSL, но другого в процессе нет
static const char *kc_open(const char *path) {
	void *h = dlopen(path, RTLD_LAZY | RTLD_GLOBAL);
	if (!h) {
		snprintf(kc_open_error, sizeof kc_open_error, "%s", dlerror());
		return kc_open_error;
	}
	int (*list)(stKCFunctionsType **) = (int (*)(stKCFunctionsType **))dlsym(h, "KC_GetFunctionList");
	if (!list) {
		const char *e = dlerror();
		snprintf(kc_open_error, sizeof kc_open_error, "%s", e ? e : "KC_GetFunctionList not found");
		dlclose(h);
		return kc_open_error;
	}
	list(&kc);
	if (!kc) {
		dlclose(h);
		return "KC_GetFunctionList returned no function table";
	}
	return NULL;
}

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

// rv = 0 ещё не значит, что подпись верна: результат проверки самой подписи есть только
// в info, см. signatureConfirmed
static unsigned long kc_verify(int flags, char *cms, int cmsLen, char *data, int *dataLen,
		char *info, int *infoLen, char *cert, int *certLen) {
	return kc->VerifyData("", flags, "", 0, (unsigned char *)cms, cmsLen, data, dataLen,
		info, infoLen, 0, cert, certLen);
}

// id с 1, как в test.cpp из SDK. VerifyData при inCertID = 0 сертификат не отдаёт
// KC_GetCertFromCMS ищет его по sid так же, как VerifyData при проверке: первый в наборе
// с тем же IssuerAndSerialNumber, для SubjectKeyIdentifier так же
static unsigned long kc_cert_from_cms(char *cms, int cmsLen, int id, char *cert, int *certLen) {
	return kc->KC_GetCertFromCMS(cms, cmsLen, id, KC_SIGN_CMS | KC_IN_BASE64 | KC_OUT_PEM, cert, certLen);
}

// цепочка до доверенного корня с подписями УЦ, срок и отзыв по файлу CRL
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
	"slices"
	"strings"
	"unsafe"
)

// данные на выходе тоже в base64, иначе двоичные обрезаются на первом нулевом байте
const (
	signFlags   = C.KC_SIGN_CMS | C.KC_IN_BASE64 | C.KC_OUT_BASE64
	verifyFlags = C.KC_SIGN_CMS | C.KC_IN_BASE64 | C.KC_IN2_BASE64 | C.KC_OUT_BASE64
	bufSize     = 64 << 10
)

// Все вызовы KalkanCrypt идут по очереди с одного OS-потока: текущий ключ и последнюю ошибку
// библиотека хранит глобально, возможно в памяти потока
var calls chan func()

func run(f func() error) error {
	if calls == nil {
		return errors.New("kalkan: Init was not called")
	}
	done := make(chan error, 1)
	calls <- func() { done <- f() }
	return <-done
}

// Init вызывается один раз на процесс. После неудачи очередь закрываем, чтобы вызовы
// не ушли в библиотеку с kc == NULL
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
		if e := C.kc_open(p); e != nil {
			return fmt.Errorf("kalkan: load %s: %s", libPath, C.GoString(e))
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

// LoadCA принимает файл в DER или PEM
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

// LoadKeyStore делает ключ текущим для SignCMS. Только для тестов и dev-команды
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

// SignCMS выдаёт то же, что createCAdESFromBase64 в NCALayer. Только для тестов и dev-команды
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

// VerifyCMS возвращает подписанные данные и сертификат подписанта (DER). rv VerifyData ловит
// хэш содержимого и signingCertificateV2, а значение подписи видно только в outVerifyInfo,
// см. signatureConfirmed. Цепочку, срок и отзыв проверяет CheckCRL. Текст KalkanCrypt в Msg
// не кладём: там имя и ИИН подписанта
func VerifyCMS(cmsB64 string) (data, certDER []byte, err error) {
	err = run(func() error {
		in := C.CString(cmsB64)
		defer C.free(unsafe.Pointer(in))
		inLen := C.int(len(cmsB64))
		outData, outInfo, outCert := make([]byte, bufSize), make([]byte, bufSize), make([]byte, bufSize)
		dataLen, infoLen, certLen := C.int(bufSize), C.int(bufSize), C.int(bufSize)
		if rv := C.kc_verify(verifyFlags, in, inLen, cbuf(outData), &dataLen,
			cbuf(outInfo), &infoLen, cbuf(outCert), &certLen); rv != 0 {
			return verifyError("verify", rv)
		}
		// подписант должен быть ровно один: при нескольких текст о неверной подписи в outVerifyInfo
		// затирается следующим
		certLen = C.int(bufSize)
		switch rv := C.kc_cert_from_cms(in, inLen, 2, cbuf(outCert), &certLen); rv {
		case C.KCR_CERTNOTFOUND:
			lastError("signer count", rv) // ожидаемо, а чтение чистит журнал KalkanCrypt
		case 0:
			return fmt.Errorf("%w: CMS has more than one signer", ErrBadSignature)
		default:
			return verifyError("signer count", rv)
		}
		if info := cstr(outInfo, infoLen); !signatureConfirmed(info) {
			return fmt.Errorf("%w: %w", ErrBadSignature, &Error{Op: "verify: signature value not confirmed"})
		}
		var err error
		if data, err = base64.StdEncoding.DecodeString(strings.Join(strings.Fields(cstr(outData, dataLen)), "")); err != nil {
			return &Error{Op: "verify: signed data is not base64"}
		}
		certLen = C.int(bufSize)
		if rv := C.kc_cert_from_cms(in, inLen, 1, cbuf(outCert), &certLen); rv != 0 {
			return verifyError("signer certificate", rv)
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

// KalkanCrypt 2.0.2 (и 2.0.14) отвечает rv = 0, даже если значение подписи не сходится с ключом
// сертификата: испорченная подпись или sid на чужой сертификат дают "Signature N 1",
// "CMS Verify - OK" без "Verify - OK". Detached, KC_IN_DER, KC_IN_PEM, KC_WITH_CERT
// и inCertID = 1 ведут себя так же. Поэтому принимаем только точный текст одной подписи,
// строка CAdES-BES бывает, если в подписи есть signingCertificateV2
func signatureConfirmed(info string) bool {
	lines := strings.Split(strings.TrimRight(info, "\n"), "\n")
	if len(lines) == 4 && lines[1] == "- CAdES-BES: verify signer certificate hash - OK." {
		lines = slices.Delete(lines, 1, 2)
	}
	return slices.Equal(lines, []string{"Signature N 1", "Verify - OK", "CMS Verify - OK"})
}

// Любой код, кроме сбоев самой библиотеки, считаем плохой подписью: VerifyData отдаёт и свои коды,
// и упакованные коды OpenSSL (0x2e09a09e не тот хэш содержимого, 0x2e09d08a нет сертификата
// подписанта, 0x8006e07b не сходится подпись ГОСТ), все не перечислить
func verifyError(op string, rv C.ulong) error {
	e := lastError(op, rv)
	e.Msg = "" // там имя и ИИН подписанта; журнал при этом уже очищен
	switch rv {
	case C.KCR_LIBRARYNOTINITIALIZED, C.KCR_MEMORY_ERROR, C.KCR_BUFFER_TOO_SMALL, C.KCR_INIT_ERROR:
		return e
	}
	return fmt.Errorf("%w: %w", ErrBadSignature, e)
}

// CheckCRL проверяет цепочку с подписями УЦ, срок и отзыв по файлу CRL. Больше цепочку никто
// не проверяет: VerifyData этого не делает, а X509ValidateCertificate с KC_USE_NOTHING
// пропускает сертификат с DN и AuthorityKeyId УЦ НУЦ, подписанный чужим ключом. Просроченный
// CRL (0x08f0005d) тоже даёт *Error, т.е. 500 на каждый запрос, пока файл не обновят. Звать
// только после Verifier.Verify: на самоподписанном сертификате без AuthorityKeyId
// X509ValidateCertificate после LoadCA падает с SIGSEGV
func CheckCRL(certDER []byte, crlPath string) error {
	return run(func() error {
		cert := C.CString(string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})))
		crl := C.CString(crlPath)
		defer C.free(unsafe.Pointer(cert))
		defer C.free(unsafe.Pointer(crl))
		info := make([]byte, 8192)
		n := C.int(len(info))
		switch rv := C.kc_check_crl(cert, C.int(C.strlen(cert)), crl, cbuf(info), &n); {
		case rv == 0:
			return nil
		case rv == C.KCR_CERT_STATUS_REVOKED:
			return ErrRevoked
		case rv < C.KCR_BASE, certRejected(rv):
			return fmt.Errorf("%w: %w", ErrBadSignature, certError(rv))
		default:
			return certError(rv)
		}
	})
}

// коды ниже KCR_BASE это X509_V_ERR из OpenSSL (7: не сошлась подпись УЦ), CheckCRL отвергает
// их все. KCR_CERTTIMEINVALID (0x08f00042) приходит и на истёкший сертификат НУЦ, и когда
// издателя нет в хранилище
func certRejected(rv C.ulong) bool {
	switch rv {
	case C.KCR_CERTTIMEINVALID, C.KCR_CERTEXPIRED, C.KCR_CERTWRONGDATE, C.KCR_CHECKCHAINERROR,
		C.KCR_CA_CERT_NOT_FOUND, C.KCR_CACERTNOTFOUND:
		return true
	}
	return false
}

// текст KalkanCrypt выкидываем, в нём имя и ИИН подписанта
func certError(rv C.ulong) *Error {
	e := lastError("validate certificate", rv)
	e.Msg = ""
	return e
}

// только на потоке KalkanCrypt и сразу после неудачного вызова
func lastError(op string, rv C.ulong) *Error {
	buf := make([]byte, 4096)
	n := C.int(len(buf))
	C.kc_last_error(cbuf(buf), &n)
	return &Error{Op: op, Code: uint32(rv), Msg: cstr(buf, n)}
}

// DER, PEM или base64, смотря откуда пришло. У DER длину берём из заголовка, хвост буфера отбрасываем
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

func cstr(b []byte, n C.int) string {
	if int(n) >= 0 && int(n) < len(b) {
		b = b[:n]
	}
	if i := bytes.IndexByte(b, 0); i >= 0 {
		b = b[:i]
	}
	return string(b)
}
