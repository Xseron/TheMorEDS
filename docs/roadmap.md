# Roadmap

## Hackathon MVP (current)
- [x] Seal registry for wallets, programs and mints on devnet
- [x] EU path: P-256 certificates verified on-chain through the secp256r1 precompile
- [x] Kazakhstan path: Go attestor on the certified KalkanCrypt library
- [x] `mor-verify-seal` crate for other programs
- [x] Token-2022 transfer hook that admits only sealed recipients
- [x] Website: address extract, sealing through NCALayer or a test attestor, sealed transfer
- [x] KASE track: corporate actions for a tokenized bond with sealed holders

## Months 1 to 2: Pilot Discovery
- [ ] Complete NCALayer integration and validate company-to-wallet registration with real Kazakhstan NCA certificates before external pilots
- [ ] Interview public-sector and platform teams
- [ ] Define reporting needs and regulatory scope

## Months 3 to 4: Security and Integration
- [ ] Improve revocation: by the organization and when the certificate is revoked
- [ ] OCSP and CRL checks for both paths
- [ ] Prepare audits and tests
- [ ] Research zero-knowledge proofs for the privacy layer

## Months 5 to 6: Mainnet Readiness
- [ ] Prepare the mainnet launch
- [ ] Complete the security review and required approvals
- [ ] Run an approved pilot

## Next Product Scope
- [ ] Individual users and sole proprietors
- [ ] Additional jurisdictions
- [ ] CAdES for EU signatures

Targets depend on pilot access, regulatory requirements and security review
