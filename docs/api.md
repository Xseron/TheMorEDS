# API Reference

## Registry program (`programs/mor-registry`)

Devnet program ID: `CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP`

### Accounts

| Account | Seeds | Main fields |
|---------|-------|-------------|
| `Config` | `["config"]` | `admin` |
| `TrustService` | `["trust", sha256(SubjectPublicKeyInfo)]` | `kind` (`P256Ca` or `Attestor`), `pubkey`, `subject_dn_hash`, `name`, `country` |
| `Certificate` | `["cert", trust_service, serial]` | `tbs_hash`, `subject_key`, `org_name`, `org_id`, `country`, `not_before`, `not_after` |
| `Seal` | `["seal", address]` | `address_kind`, `controller`, `trust_level`, `jurisdiction`, `subject_type`, `identifier_hash`, `trust_service`, `certificate`, `expires_at`, `name` |

For an attestor the Ed25519 key sits in the first 32 bytes of `pubkey`, and the seed is `sha256(pubkey)`

### Instructions

| Instruction | Who signs | What it does |
|-------------|-----------|--------------|
| `initialize` | Program upgrade authority | Creates `Config` and makes the signer the admin |
| `add_trust_service(kind, pubkey, spki_hash, subject_dn_hash, name, country)` | Admin | Adds a trusted P-256 CA or an attestor |
| `register_certificate(serial)` | Anyone | Registers an organization certificate. The previous instruction must be a secp256r1 precompile that checks the CA signature over the TBS |
| `register_seal_p256(kind, salt, expires_at, sign_deadline)` | Address controller | Seals an address. The previous instruction must be a secp256r1 precompile with the certificate key over the seal message |
| `register_seal_attested(kind, identifier_hash, name, expires_at, sign_deadline)` | Address controller | Seals an address. The previous instruction must be an Ed25519 precompile with the attestor key over the seal message |
| `revoke_seal` | Stored or current controller | Closes the seal, the rent goes back to the signer |

`kind` is `Wallet`, `Program` or `Mint`. The controller of a wallet is the wallet itself, of a program its upgrade authority, of a mint its mint authority

Precompile instructions must be self-contained: one signature, all offsets inside the same instruction. The program reads the key and the message at exactly the offsets the precompile checked

### Seal message

The organization (EU path) or the attestor (Kazakhstan path) signs these bytes:

| Field | Size |
|-------|------|
| `"MOR-SEAL-V1"` | 11 |
| registry program ID | 32 |
| address | 32 |
| address kind | 1 |
| controller | 32 |
| trust level | 1 |
| trust service | 32 |
| certificate (zeros for the attestor) | 32 |
| jurisdiction, ISO 3166 alpha-2 | 2 |
| subject type | 1 |
| identifier hash | 32 |
| `expires_at`, i64 LE | 8 |
| `sign_deadline`, i64 LE | 8 |
| name length | 1 |
| name, 1..128 bytes of UTF-8 | n |

`identifier_hash = sha256(salt || jurisdiction || identifier)`, where the identifier is the BIN in Kazakhstan or `organizationIdentifier` from the EU certificate. The owner can reveal `(identifier, salt)` to a counterparty off-chain

## `mor-verify-seal` crate

```rust
use mor_verify_seal::{verify_seal, TrustLevel};

let seal = verify_seal(&seal_account, &owner, TrustLevel::Attestor)?;
```

- `seal_account`: the PDA `["seal", owner]` of the registry
- `TrustLevel::Attestor < TrustLevel::Trustless`, the check is `>=`
- Returns `Seal` with `address_kind`, `controller`, `trust_level`, `jurisdiction`, `identifier_hash`, `trust_service`, `certificate`, `expires_at`, `created_at`
- Errors are `ProgramError::Custom(9100 + n)`: `NotSealed` 9100, `WrongAccount` 9101, `Expired` 9102, `TrustTooLow` 9103
- `verify_seal_at(..., now)` takes the time explicitly, for tests
- Feature `test-utils` builds seal account data for tests of consumer programs

## Attestor HTTP API (`attestor/`)

Default address `http://127.0.0.1:8787`

### Attest

```
POST /v1/attest
```

Body `{"cms": "<base64>"}`, at most 64 KiB: an attached CMS (CAdES) over the request text. The text is UTF-8 with LF line ends and no newline at the end:

```
MOR-SEAL-REQUEST-V1
program: <registry program ID>
address: <address to seal>
kind: wallet | program | mint
controller: <address controller>
expires: <unix>
deadline: <unix, at most 15 minutes ahead>
```

**Response:**
```json
{
  "message": "<seal message, base64>",
  "signature": "<Ed25519 signature, base64>",
  "attestor": "<attestor key, base58>",
  "trustService": "<TrustService PDA>",
  "name": "ТОО «Ромашка»",
  "bin": "<12 digits>",
  "salt": "<hex, kept by the address owner>",
  "identifierHash": "<hex>",
  "expiresAt": 1806451200,
  "signDeadline": 1791550800
}
```

`expiresAt` is capped by the end of the signer certificate. The salt and BIN go only to the caller, the attestor doesn't store them

**Errors:** `{"error": "<code>", "message": "<text>"}`

| Status | Codes |
|--------|-------|
| 400 | `bad_json`, `bad_base64` |
| 401 | `bad_signature`: CMS signature or NCA chain is invalid |
| 403 | `revoked`, `cert_not_valid_now`, `not_legal_entity`, `role_not_allowed`, `no_bin`, `no_org_name` |
| 422 | `bad_request_text`, `wrong_program`, `deadline_out_of_window`, `expires_in_past` |
| 500 | `kalkan_error`, `internal` |

Only the first head or an employee with signing rights of a legal entity may seal

### Info

```
GET /v1/info
```

Returns `{"attestor", "trustService", "program"}`

### Command line

```bash
attestor serve --listen 127.0.0.1:8787 --key fixtures/keys/attestor.json \
  --ca <CA file> --crl <CRL file> --program <registry ID> --cors-origin http://localhost:3000
attestor sign-request --p12 <key.p12> --password <password> --request <file>
```

`--ca` and `--crl` repeat, the defaults are the NCA test CAs and CRL from `pkisdk/`. `--kalkan-lib` (or `KALKAN_LIB`) points to KalkanCrypt, by default the certified 2.0.2 from the SDK. `sign-request` signs a request without NCALayer, for tests

## Devnet faucet (`web/drip`)

```
POST /api/drip
```

Body `{"address": "<wallet>"}`. Sends 0.05 devnet SOL and 50 demo tokens once per address. Limits: 5 requests per hour per IP, 300 per day

| Response | Meaning |
|----------|---------|
| `200 {"ok": true, "signature", "sol", "tokens"}` | Sent |
| `200 {"ok": true, "already": true}` | This address was served before |
| `400 {"error": "bad_address"}` | Not a Solana address |
| `429 {"error": "rate_limited"}` | Limit reached |
| `503 {"error": "drip_empty"}` | Issuer is out of SOL |

```
GET /api/drip/health
```

Returns `{"ok": true, "issuer", "balanceSol", "served"}`
