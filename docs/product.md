# Product

## What is MOR?

MOR (from Kazakh "мөр", seal) links a company to a Solana wallet so applications can verify its identity. The company signs once with the electronic signature it already holds, and the wallet gets an organization seal that any Solana program can check

A wallet shows its full transaction history but not the legal counterparty behind it. Today company identity and wallet control need extra evidence, and each platform runs its own onboarding for business counterparties. A seal is reusable: one signature, checked by every application

## First Customers and Users

- **Users:** corporate wallets of companies with electronic signatures
- **Initial geography:** Kazakhstan, then compatible EU organization certificates
- **First buyer hypothesis:** payment and asset platforms that must verify business counterparties
- **B2G pilot opportunity:** the Alatau City ecosystem and government reporting teams

## Core Value Propositions

1. **Reusable verification:** one seal works across all Solana applications instead of a separate onboarding per platform
2. **Signatures companies already have:** NCA keys in Kazakhstan, organization certificates in the EU
3. **Enforced on-chain:** a Token-2022 transfer hook lets a token move only between sealed wallets of the required trust level
4. **No personal data on-chain:** the seal holds the company name and a salted hash of its registry number
5. **Explicit trust model:** accepted certificate authorities and attestors are listed in the registry, and each seal shows its trust level

## How It Differs

| Approach | Identity source | Application access | Main dependency |
|----------|-----------------|--------------------|-----------------|
| Licensed exchanges | Customer onboarding | Exchange integration | Licensed operator |
| KYB platforms, e.g. Sumsub | Documents and company registries | Provider API | Verification provider |
| Attestations, e.g. EAS | Issuer-defined claims | Attestation schema | Attestation issuer |
| **MOR** | Electronic signatures of organizations | Solana registry + Token-2022 hook | Trusted CAs + Kazakhstan attestor |

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
