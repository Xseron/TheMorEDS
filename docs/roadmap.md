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
- [ ] Legal review: which licenses and approvals MOR needs in each jurisdiction

## Months 3 to 4: Security and Integration
- [ ] Improve revocation: by the organization and when the certificate is revoked
- [ ] OCSP and CRL checks for both paths
- [ ] Prepare audits and tests
- [ ] ZK proof of the GOST 34.10-2015 signature check: SP1 or RISC Zero, wrapped into Groth16 and verified on Solana through alt_bn128 syscalls. The attestor becomes a relay, and the signer's certificate never leaves the company
- [ ] Until then, commit the hash of the signed request in every attested seal, so any seal can be matched with its evidence on request
- [ ] Check the company's status in the state business register, not only the certificate

## Months 5 to 6: Mainnet Readiness
- [ ] Prepare the mainnet launch
- [ ] Complete the security review and required approvals
- [ ] Run an approved pilot

## Licenses and Approvals
- [ ] Agreement with NCA of Kazakhstan for production use of KalkanCrypt and NCA certificates in the attestor
- [ ] Approval to run the pilot under the digital-asset rules of Alatau City
- [ ] AFSA FinTech Lab (regulatory sandbox) or a license to work with AIFC participants
- [ ] EU: qualified trust service status under eIDAS if MOR validates qualified seals as a service
- [ ] Personal data compliance for the attestor: Kazakhstan's personal data law and GDPR

The exact list depends on the legal review and on how each regulator classifies MOR

## Going Global
- [ ] Qualified organization certificates from all EU member states, not only P-256: other algorithms through the attestor
- [ ] Other countries with a national PKI or qualified electronic signatures. Each one is an adapter, not a new product: on-chain verification when Solana has a precompile for the algorithm, an attestor when it doesn't
- [ ] Licenses and approvals in each new jurisdiction before launch there
- [ ] Individual users and sole proprietors
- [ ] CAdES for EU signatures

## Other Networks
- [ ] EVM networks with a P-256 precompile (RIP-7212 on L2s, EIP-7951 on Ethereum): a registry contract and a token transfer check in the style of ERC-3643
- [ ] One attestor for all networks: the same signature check, the result signed in the format of the target network
- [ ] One signature from the company, seals on several networks

Targets depend on pilot access, regulatory requirements and security review
