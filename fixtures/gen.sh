#!/usr/bin/env bash
# Тестовый УЦ «Mör Test QTSP» на P-256 и набор сертификатов для тестов.
# Запуск из WSL: bash fixtures/gen.sh   (нужен OpenSSL 3). Ключи не сохраняются.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf work && mkdir work && cd work

# Minimal openssl config so `openssl req -x509` does not also pull in the
# default config's [v3_ca] extensions (which would duplicate/conflict with
# our -addext flags on OpenSSL 3.0.13).
cat > minimal.cnf <<'EOF'
[req]
distinguished_name = req_distinguished_name
[req_distinguished_name]
EOF

ec_key() { openssl ecparam -name prime256v1 -genkey -noout -out "$1"; }

ca_cert() { # ca_cert <out.pem> <key> <subject>
  openssl req -x509 -new -utf8 -key "$2" -sha256 -days 3650 -subj "$3" \
    -config minimal.cnf \
    -addext "basicConstraints=critical,CA:true" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" -out "$1"
}

issue() { # issue <name> <key> <subject> <ca.pem> <ca.key> <extfile>
  openssl req -new -utf8 -key "$2" -subj "$3" -config minimal.cnf -out "$1.csr"
  openssl x509 -req -in "$1.csr" -CA "$4" -CAkey "$5" -CAcreateserial -sha256 -days 3650 \
    -extfile "../$6" -out "$1.pem"
  openssl x509 -in "$1.pem" -outform DER -out "../$1.der"
}

ec_key ca1.key
ca_cert ca1.pem ca1.key "/C=EE/O=Mor Test QTSP/organizationIdentifier=NTREE-10000001/CN=Mor Test QTSP CA 1"
# Тот же ключ, другой DN: для IssuerMismatch
ca_cert ca1b.pem ca1.key "/C=EE/O=Mor Test QTSP/organizationIdentifier=NTREE-10000001/CN=Mor Test QTSP CA 1 ROLLOVER"
ec_key ca2.key
ca_cert ca2.pem ca2.key "/C=LT/O=Other QTSP/organizationIdentifier=NTRLT-20000002/CN=Other QTSP CA"
for c in ca1 ca1b ca2; do openssl x509 -in $c.pem -outform DER -out ../$c.der; done

ACME="/C=EE/O=Acme Robotics/organizationIdentifier=NTREE-12345678/CN=Acme Robotics"
ec_key ee.key
issue ee_small        ee.key "$ACME" ca1.pem ca1.key ee_small.ext
issue ee_large        ee.key "/C=EE/O=Acme Robotics OÜ/organizationIdentifier=NTREE-12345678/CN=Acme Robotics OÜ seal" ca1.pem ca1.key ee_large.ext
issue ee_other_ca     ee.key "$ACME" ca2.pem ca2.key ee_small.ext
issue ee_wrong_issuer ee.key "$ACME" ca1b.pem ca1.key ee_small.ext
issue ee_no_orgid     ee.key "/C=EE/O=Acme Robotics/CN=Acme Robotics" ca1.pem ca1.key ee_small.ext
issue ee_person       ee.key "/C=EE/O=Acme Robotics/organizationIdentifier=NTREE-12345678/SN=Tamm/GN=Mari/serialNumber=PNOEE-38001085718/CN=Mari Tamm" ca1.pem ca1.key ee_small.ext
openssl genrsa -out rsa.key 2048 2>/dev/null
issue ee_rsa          rsa.key "$ACME" ca1.pem ca1.key ee_small.ext

cd .. && rm -rf work
for f in *.der; do printf "%-22s %5d bytes\n" "$f" "$(stat -c %s "$f")"; done
