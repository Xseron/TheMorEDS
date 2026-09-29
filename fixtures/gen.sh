#!/usr/bin/env bash
# Тестовый УЦ «Mör Test QTSP» на P-256 и набор сертификатов для тестов.
# Запуск из WSL: bash fixtures/gen.sh   (нужен OpenSSL 3).
# Ключи лежат в fixtures/keys/ (только для тестов): создаются, если их нет, иначе
# переиспользуются. Сертификаты выпускаются заново из этих ключей при каждом запуске.
set -euo pipefail
cd "$(dirname "$0")"
KEYS="$PWD/keys"
mkdir -p "$KEYS"
rm -rf work && mkdir work && cd work

# Minimal openssl config so `openssl req -x509` does not also pull in the
# default config's [v3_ca] extensions (which would duplicate/conflict with
# our -addext flags on OpenSSL 3.0.13).
cat > minimal.cnf <<'EOF'
[req]
distinguished_name = req_distinguished_name
[req_distinguished_name]
EOF

ec_key() { [ -f "$1" ] || openssl ecparam -name prime256v1 -genkey -noout -out "$1"; }
rsa_key() { [ -f "$1" ] || openssl genrsa -out "$1" 2048 2>/dev/null; }

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

CA1_KEY="$KEYS/ca1.key" CA2_KEY="$KEYS/ca2.key" EE_KEY="$KEYS/ee.key" RSA_KEY="$KEYS/rsa.key"
ec_key "$CA1_KEY"
ec_key "$CA2_KEY"
ec_key "$EE_KEY"
rsa_key "$RSA_KEY"

ca_cert ca1.pem "$CA1_KEY" "/C=EE/O=Mor Test QTSP/organizationIdentifier=NTREE-10000001/CN=Mor Test QTSP CA 1"
# Тот же ключ, другой DN: для IssuerMismatch
ca_cert ca1b.pem "$CA1_KEY" "/C=EE/O=Mor Test QTSP/organizationIdentifier=NTREE-10000001/CN=Mor Test QTSP CA 1 ROLLOVER"
ca_cert ca2.pem "$CA2_KEY" "/C=LT/O=Other QTSP/organizationIdentifier=NTRLT-20000002/CN=Other QTSP CA"
for c in ca1 ca1b ca2; do openssl x509 -in $c.pem -outform DER -out ../$c.der; done

ACME="/C=EE/O=Acme Robotics/organizationIdentifier=NTREE-12345678/CN=Acme Robotics"
issue ee_small        "$EE_KEY" "$ACME" ca1.pem "$CA1_KEY" ee_small.ext
issue ee_large        "$EE_KEY" "/C=EE/O=Acme Robotics OÜ/organizationIdentifier=NTREE-12345678/CN=Acme Robotics OÜ seal" ca1.pem "$CA1_KEY" ee_large.ext
issue ee_other_ca     "$EE_KEY" "$ACME" ca2.pem "$CA2_KEY" ee_small.ext
issue ee_wrong_issuer "$EE_KEY" "$ACME" ca1b.pem "$CA1_KEY" ee_small.ext
issue ee_no_orgid     "$EE_KEY" "/C=EE/O=Acme Robotics/CN=Acme Robotics" ca1.pem "$CA1_KEY" ee_small.ext
issue ee_person       "$EE_KEY" "/C=EE/O=Acme Robotics/organizationIdentifier=NTREE-12345678/SN=Tamm/GN=Mari/serialNumber=PNOEE-38001085718/CN=Mari Tamm" ca1.pem "$CA1_KEY" ee_small.ext
issue ee_rsa          "$RSA_KEY" "$ACME" ca1.pem "$CA1_KEY" ee_small.ext

cd .. && rm -rf work
for f in *.der; do printf "%-22s %5d bytes\n" "$f" "$(stat -c %s "$f")"; done
