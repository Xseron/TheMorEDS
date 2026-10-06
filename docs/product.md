# Product

## What is MOR?

MOR (from Kazakh "мөр", seal) links a company to a Solana wallet so applications can verify its identity. The company signs once with the electronic signature it already holds, and the wallet gets an organization seal that any Solana program can check

A wallet shows its full transaction history but not the legal counterparty behind it. Today company identity and wallet control need extra evidence, and each platform runs its own onboarding for business counterparties

## First Customers and Users

- **Users:** corporate wallets of companies with electronic signatures
- **Geography:** Kazakhstan first, then compatible EU organization certificates, then other countries with a national PKI or qualified electronic signatures
- **First buyer hypothesis:** payment and asset platforms that must verify business counterparties
- **B2G pilot opportunity:** the Alatau City ecosystem and government reporting teams

## Core Value Propositions

1. **The state is the source of trust:** the seal rests on a qualified or national electronic signature, the same one a company uses for tax filings and contracts, not on a provider's review
2. **Verifiable, not vouched for:** on the EU path the program itself checks the certificate and the signatures. On the Kazakhstan path the attestor only checks the company's own signature, and a ZK proof is planned to replace even that
3. **The right person signs:** in Kazakhstan only the first head or an employee with signing rights can seal, the role comes from the NCA certificate. In the EU it's the organization's own certificate
4. **Seconds and cents:** one signature, a few seconds, about 0.003 SOL of account rent that comes back when the seal is revoked
5. **No personal data on-chain:** the company name and a salted hash of the BIN or registry number. Nothing about the person who signed
6. **The registry is the product:** any Solana program reads a seal with one call. The Token-2022 hook is one consumer, for permissioned tokens such as tokenized securities and B2B settlement tokens

## Beyond Solana

The seal model doesn't depend on Solana: who stands behind an address, the trust level, the expiry and a salted hash of the registry number. The attestor checks signatures off-chain and only signs the result, so it can serve any network. On EVM networks with a P-256 precompile the EU path works on-chain too, and the token rule becomes a transfer check in the style of ERC-3643

Solana is the first network: the registry, the `mor-verify-seal` crate and the Token-2022 hook are built and running on devnet

## How It Differs

| | Source of trust | Can anyone re-check it? | Cost and time | Revocation | Privacy |
|---|---|---|---|---|---|
| KYB providers, e.g. Sumsub | The provider | No | Hours to days, a fee per check | Manual | Documents stay with the provider |
| Civic Pass | The KYC provider | No | Minutes to days | Yes, by the provider | Gateway token without PII |
| Solana Attestation Service, EAS | The attestation issuer | No, the issuer is the source of truth | Depends on the issuer | Yes, by the issuer | Depends on the schema |
| **MOR** | State and qualified CAs | EU path: yes, verified by the program and kept in the ledger. Kazakhstan: the company keeps the signed request | Seconds, about 0.003 SOL of rent that comes back on revoke | Expiry no later than the certificate, CRL at sealing time | Company name and a salted hash of the BIN, nothing about the signer |

**Solana Attestation Service (SAS).** The native attestation layer from the Solana Foundation, launched in 2025 with Civic and other issuers. It's the closest thing to a "Solana registry", and MOR is an attestation too. The difference is the source of trust: an SAS issuer is the source of truth, while MOR only records what a state signature already proves. MOR seals could be published as SAS attestations later, the two don't exclude each other

**Civic Pass.** Gateway tokens: verified wallets get a pass that programs and tokens check before letting them in. It's the same "verified, then allowed" pattern, but the check is the provider's KYC, so trust rests on the provider. MOR verifies legal entities by their own electronic signature

**Coinbase Verifications.** Attestations that a wallet belongs to a verified Coinbase customer. Coinbase is the issuer, and only its customers are covered

**zkTLS: Reclaim, zkPass.** Prove data from a web session, for example a page of a government portal, without revealing it. Trust rests on the website and the TLS session. A qualified electronic signature is a stronger legal artifact: in Kazakhstan and the EU it has the force of a handwritten signature

**Privado ID (formerly Polygon ID).** Verifiable credentials with selective disclosure through ZK proofs. The credential issuer is still the source of truth

## Coverage Today and Next

- **Today:** Kazakhstan through the attestor, for every legal entity with an NCA key. EU organization certificates with P-256 verified on-chain. On devnet the trust list holds test CAs only
- **Next:** qualified certificates from all EU member states, other algorithms through the attestor, then other countries with a national PKI or qualified electronic signatures. A new country is an adapter, not a new product

## Honest Limits

- **Freshness:** a signature proves who signed, not that the company is still active. A seal can't outlive the certificate, and NCA certificates last about a year, so a company re-seals at least once a year with a fresh signature, which checks the signer's role again. Checks against the state business register are on the roadmap
- **Revocation:** the attestor checks the NCA CRL at sealing time. A certificate revoked later doesn't remove the seal yet
- **Token-2022 hook:** it works only for tokens created with the extension, so it doesn't touch SOL, USDC or most existing tokens. Some wallets and DEXes handle hooks poorly, and a hook adds accounts and compute to every transfer. That's why the registry is the product and the hook is one consumer

## Planned Scenario: Alatau City

Kazakhstan has adopted a constitutional law on the special legal regime of Alatau City with its own digital-asset rules. A possible government-token scenario:

1. The state issues an approved token that moves only to sealed wallets
2. A verified company pays another company. MOR checks the buyer and seller wallets
3. The receipt feeds an authorized reporting integration

Today declarations go through accounting and periodic reports. With seals, reporting can read transfers between sealed wallets as they happen, with the company on each side. This is a planned scenario: asset registries and reporting require integration with the city

## Regulatory Context

- FATF Recommendation 16 (Travel Rule): virtual asset service providers obtain and pass on originator and beneficiary information
- Regulation (EU) 2023/1113: since 30 December 2024 EU crypto-asset service providers attach originator and beneficiary information to every transfer
- Law of Kazakhstan No. 193-VII on digital assets, Article 12-1: licensed providers collect information on the sender and the recipient
- Kazakhstan tax forms 270.00 and 250.00 already ask individuals for the wallet address of their digital assets

The full list of sources is on the [landing page](https://morseal.ink). This is not legal advice
