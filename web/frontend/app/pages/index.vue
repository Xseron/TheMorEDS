<template>
  <div class="space-y-20 md:space-y-28">
    <!-- 1. Hero -->
    <section>
      <div class="grid grid-cols-1 items-center gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div>
          <h1 class="text-balance">Who stands behind this Solana address?</h1>
          <p class="mt-5 max-w-[34rem] text-[19px] text-muted">An organization seal answers it: the company signs with the electronic signature it already holds, and applications check the seal.</p>
          <form class="mt-8 flex max-w-[34rem] flex-wrap gap-2" @submit.prevent="check">
            <label for="hero-address" class="sr-only">Solana address</label>
            <input id="hero-address" v-model="query" class="field min-w-0 flex-1 basis-56 font-mono placeholder:font-sans" placeholder="Solana address" autocomplete="off" spellcheck="false">
            <button class="btn btn-primary max-sm:w-full">Check address</button>
          </form>
          <p class="note mt-4">
            Try:
            <NuxtLink :to="`/address/${DEMO.a}`" class="whitespace-nowrap">Acme Robotics OÜ, EU</NuxtLink> ·
            <NuxtLink :to="`/address/${DEMO.b}`" class="whitespace-nowrap">ТОО «Ромашка», Kazakhstan</NuxtLink> ·
            <NuxtLink :to="`/address/${DEMO.c}`" class="whitespace-nowrap">unsealed wallet</NuxtLink>
          </p>
          <NuxtLink to="/seal" class="btn mt-8">Seal your wallet</NuxtLink>
        </div>
        <Illustration src="/img/hero.svg" alt="" ratio="20/13" class="order-first md:order-none" />
      </div>

      <div class="band -mx-5 mt-12 rounded-none px-5 py-8 sm:mx-0 sm:rounded-card sm:p-8 md:mt-16 md:p-12">
        <div class="mx-auto max-w-[56rem]">
          <HeroExtract />
          <p class="note mt-4">Live extract from Solana devnet: a demo company sealed through the test attestor.</p>
        </div>
      </div>
    </section>

    <!-- 2. The wallet identity gap -->
    <section>
      <div class="grid grid-cols-1 items-center gap-x-16 gap-y-10 md:grid-cols-2">
        <div>
          <p class="eyebrow">Problem</p>
          <h2 class="mt-3 text-balance">The wallet identity gap</h2>
          <div class="mt-6 max-w-[66ch] space-y-4">
            <p>A Solana wallet shows its full transaction history but not the legal counterparty behind it. Company identity and wallet control require additional evidence.</p>
            <p>So each platform runs its own onboarding and verification for business counterparties, and the result stays inside that platform.</p>
            <p>Rules for banks, payment providers and digital-asset service providers already ask who receives a transfer.<sup class="whitespace-nowrap"><a href="#src-1">[1]</a><a href="#src-2">[2]</a><a href="#src-3">[3]</a><a href="#src-4">[4]</a></sup> In Kazakhstan, licensed digital-asset providers must also check their customers.<sup class="whitespace-nowrap"><a href="#src-5">[5]</a><a href="#src-6">[6]</a></sup></p>
          </div>
        </div>
        <Illustration src="/img/gap.svg" alt="" ratio="19/14" />
      </div>
      <Notes :items="notes.slice(0, 6)" class="md:columns-2" />
      <p class="note mt-6">Sources checked on 3 October 2026. This is not legal advice.</p>
    </section>

    <!-- 3. Who it's for -->
    <section class="band -mx-5 rounded-none px-5 py-12 sm:mx-0 sm:rounded-card sm:p-8 md:p-12">
      <p class="eyebrow">Use cases</p>
      <h2 class="mt-3 text-balance">Who it's for</h2>
      <div class="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        <article class="card-white">
          <Illustration src="/img/platforms.svg" alt="" ratio="4/3" class="w-52" />
          <h3 class="mt-6">Payment and asset platforms</h3>
          <p class="mt-2">Platforms that must verify business counterparties check the organization seal instead of running a separate onboarding for each company.</p>
        </article>
        <article class="card-white">
          <Illustration src="/img/government.svg" alt="" ratio="4/3" class="w-52" />
          <h3 class="mt-6">Government reporting teams</h3>
          <p class="mt-2">Transfers between sealed wallets show the company on each side. We see the first pilot opportunity in the Alatau City ecosystem.</p>
        </article>
      </div>
      <dl class="card-white mt-5 grid grid-cols-1 gap-x-12 gap-y-6 md:grid-cols-2">
        <div>
          <dt class="label">Today</dt>
          <dd class="mt-2">Declarations go through accounting and periodic reports.</dd>
        </div>
        <div>
          <dt class="label">With MOR</dt>
          <dd class="mt-2">Reporting reads transfers of a state-issued token between sealed wallets as they happen, with the company on each side.</dd>
        </div>
      </dl>
      <p class="note mt-8">First users: corporate wallets with electronic signatures. Kazakhstan comes first, then compatible EU organization certificates.</p>
    </section>

    <!-- 4. Alatau City -->
    <section>
      <div class="grid grid-cols-1 items-center gap-x-16 gap-y-8 md:grid-cols-2">
        <div>
          <h2 class="text-balance">Alatau City: a planned scenario</h2>
          <p class="mt-5 max-w-[66ch]">Switch the ledger to see what a reporting team would see, with and without seals.</p>
        </div>
        <Illustration src="/img/alatau.svg" alt="" ratio="2/1" />
      </div>
      <Ledger class="mt-10" />
      <ol class="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
        <li v-for="(s, i) in scenario" :key="i" class="flex items-baseline gap-5 md:block">
          <span class="block w-6 shrink-0 text-[40px] font-extrabold leading-none text-violet">{{ i + 1 }}</span>
          <p class="md:mt-3">{{ s }}</p>
        </li>
      </ol>
      <p class="note mt-10">Planned scenario with example data.<sup class="whitespace-nowrap"><a href="#src-7">[7]</a><a href="#src-8">[8]</a></sup> Asset registries and reporting require integration with the city.</p>
      <Notes :items="notes.slice(6, 8)" class="md:columns-2" />
    </section>

    <!-- 5. How it works -->
    <section class="band -mx-5 rounded-none px-5 py-12 sm:mx-0 sm:rounded-card sm:p-8 md:p-12">
      <p class="eyebrow">Mechanism</p>
      <h2 class="mt-3 text-balance">How it works</h2>
      <ol class="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        <li v-for="(s, i) in steps" :key="s.title" class="card-white flex flex-col">
          <Illustration :src="`/img/${s.icon}.svg`" alt="" ratio="1/1" class="w-[72px]" />
          <h3 class="mt-5"><span class="mr-2 font-extrabold text-violet">{{ i + 1 }}</span>{{ s.title }}</h3>
          <p class="mb-5 mt-2">{{ s.text }}</p>
          <pre class="code mt-auto"><template v-if="s.seal">seal <NuxtLink :to="`/address/${DEMO.b}`">{{ s.seal }}</NuxtLink>{{ '\n' }}</template>{{ s.artifact }}</pre>
        </li>
      </ol>
      <p class="mt-10 text-[20px] font-extrabold">Valid required seal: allow. Missing or expired seal: reject.</p>
      <div class="card-white mt-6">
        <pre class="code">let seal = mor_verify_seal::verify_seal(&amp;seal_account, &amp;owner, TrustLevel::Attestor)?;</pre>
        <p class="note mt-3">One call from the mor-verify-seal crate, in any Solana program.</p>
        <NuxtLink to="/transfer" class="btn btn-primary mt-6">Try the sealed transfer</NuxtLink>
      </div>
    </section>

    <!-- 6. For the city -->
    <section class="grid grid-cols-1 items-center gap-x-16 gap-y-10 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Illustration src="/img/city.svg" alt="" ratio="1/1" class="mx-auto w-full max-w-[26rem]" />
      <div>
        <h2 class="text-balance">For the city</h2>
        <dl class="mt-8 max-w-[66ch]">
          <div v-for="c in city" :key="c.term" class="border-t border-line py-5">
            <dt class="font-bold">{{ c.term }}</dt>
            <dd class="mt-1 text-muted">{{ c.text }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 7. Existing approaches and MOR -->
    <section>
      <h2 class="text-balance">Existing approaches and MOR</h2>
      <div class="mt-6 max-w-[66ch] space-y-4">
        <p>In Kazakhstan, individuals declare digital assets on tax forms 270.00 and 250.00, which ask for the exchange or wallet name and the wallet address.<sup class="whitespace-nowrap"><a href="#src-9">[9]</a></sup></p>
        <p>The wallet address is already what the state asks for. MOR adds the company behind the address, confirmed by its electronic signature.</p>
      </div>
      <div class="card mt-10">
        <div class="overflow-x-auto rounded-control bg-paper">
          <table class="w-full min-w-[44rem] text-[15px]">
            <thead>
              <tr class="label">
                <th v-for="c in ['Approach', 'Identity source', 'Application access', 'Main dependency']" :key="c" class="px-5 pb-3 pt-5 text-left">{{ c }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in approaches" :key="r[0]" class="border-t border-line align-top" :class="{ 'bg-lilac-soft font-bold': r[0] === 'MOR' }">
                <th scope="row" class="px-5 py-4 text-left" :class="r[0] === 'MOR' ? 'font-extrabold' : 'font-bold'">{{ r[0] }}</th>
                <td v-for="c in r.slice(1)" :key="c" class="px-5 py-4">{{ c }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p class="mt-6 max-w-[66ch]"><b>Reusable verification across Solana applications.</b> The trust model stays explicit: accepted certificate authorities and attestors.</p>
      <Notes :items="notes.slice(8, 9)" class="max-w-[66ch]" />
    </section>

    <!-- 8. Roadmap -->
    <section class="band -mx-5 rounded-none px-5 py-12 sm:mx-0 sm:rounded-card sm:p-8 md:p-12">
      <h2 class="text-balance">Roadmap</h2>
      <p class="mt-4"><b>Now:</b> company-wallet registry and Token-2022 demo on Solana devnet.</p>
      <ol class="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
        <li v-for="p in roadmap" :key="p.label" class="card-white">
          <p class="label">{{ p.label }}</p>
          <h3 class="mt-3">{{ p.title }}</h3>
          <p class="mt-2">{{ p.text }}</p>
        </li>
      </ol>
      <p class="mt-8">Next product scope: individual users and additional jurisdictions.</p>
      <p class="note mt-2">Targets depend on pilot access, regulatory requirements and security review.</p>
    </section>

    <!-- 9. Team -->
    <section>
      <h2 class="text-balance">Team</h2>
      <p class="mt-4">Both founders study Information Systems at KBTU.</p>
      <div class="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
        <article v-for="p in team" :key="p.name" class="card flex flex-col">
          <h3>{{ p.name }}</h3>
          <p class="text-muted">{{ p.role }}</p>
          <p class="mb-6 mt-5">{{ p.text }}</p>
          <p class="mt-auto">Telegram <a :href="`https://t.me/${p.telegram}`" target="_blank" rel="noopener" class="font-bold">@{{ p.telegram }}</a></p>
        </article>
      </div>
    </section>

    <!-- 10. Questions -->
    <section class="grid grid-cols-1 gap-x-16 gap-y-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <h2 class="text-balance">Questions</h2>
      <div class="max-w-[66ch] border-t border-line">
        <details v-for="f in faq" :key="f.q" class="group border-b border-line py-5">
          <summary class="flex cursor-pointer list-none items-start justify-between gap-6 font-bold [&::-webkit-details-marker]:hidden">
            {{ f.q }}
            <Icon name="ph:plus-bold" size="20" class="mt-1 shrink-0 text-violet group-open:hidden" />
            <Icon name="ph:minus-bold" size="20" class="mt-1 hidden shrink-0 text-violet group-open:block" />
          </summary>
          <p class="mt-3 text-muted">{{ f.a }}</p>
        </details>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h, type PropType } from 'vue'
import { DEMO } from '~/utils/registry'

// Те же вопросы уходят в schema.org FAQPage
const faq = [
  { q: 'Does any personal data go on-chain?', a: 'No. A seal holds company data only: the company name and sha256(salt, jurisdiction, BIN or registry number). The salt stays with the owner, and the registry does not record the person who signed for the company.' },
  { q: 'Who can seal a wallet?', a: 'A company that holds an electronic signature. In Kazakhstan, its head or an employee with signing rights signs with an NCA key; in the EU, the company signs with a compatible organization certificate. The wallet controller then registers the seal.' },
  { q: 'What happens to a transfer to an unsealed wallet?', a: 'The Token-2022 transfer hook rejects it. The same happens when the recipient\'s seal has expired or its trust level is below what the token requires. On this site the transfer fails simulation, so your wallet never asks you to sign.' },
  { q: 'Which signatures are supported?', a: 'Kazakhstan: signatures made with NCA keys through NCALayer, checked off-chain by an attestor. EU: P-256 eIDAS certificates, with the certificate and signature verified by the program on-chain. The seal records the path as its trust level: Attested or On-chain.' },
  { q: 'Is MOR live on mainnet?', a: 'Not yet. The registry and the demo token run on Solana devnet, and the certificate authority and attestor use public test keys, so anyone can mint such seals. Mainnet readiness is planned for months 5 to 6 of the roadmap.' },
]

// Шаблон сайта дописывает « | MOR», поэтому заголовок без названия в начале (copy.md, Meta)
useSeoMeta({
  title: 'On-chain KYC for companies on Solana',
  description: 'MOR links a company to a Solana wallet with its electronic signature. Check who stands behind an address, seal your wallet, try the sealed transfer.',
  ogTitle: 'MOR: on-chain KYC with electronic signatures',
  ogDescription: 'MOR links a company to a Solana wallet so applications can verify its identity. Live demo on Solana devnet.',
  twitterCard: 'summary_large_image',
})
defineOgImageComponent('Default', {
  title: 'On-chain KYC with electronic signatures',
  description: 'MOR links a company to a Solana wallet so applications can verify its identity.',
})
useSchemaOrg([
  defineOrganization({ name: 'MOR', logo: '/img/mark.png', sameAs: ['https://t.me/dtorossyan', 'https://t.me/ablStartup'] }),
  defineWebSite({ name: 'MOR' }),
  defineSoftwareApp({ name: 'MOR', applicationCategory: 'FinanceApplication', operatingSystem: 'Web', offers: { price: 0, priceCurrency: 'USD' } }),
  defineWebPage({ '@type': 'FAQPage' }),
  ...faq.map(f => defineQuestion({ name: f.q, acceptedAnswer: f.a })),
])

const query = ref('')
function check() {
  const a = query.value.trim()
  if (a) navigateTo(`/address/${encodeURIComponent(a)}`)
}

type Note = { n: number; text: string; source: string; links: [string, string][] }
const notes: Note[] = [
  {
    n: 1,
    text: 'The FATF standard known as the Travel Rule requires virtual asset service providers to obtain and hold originator and beneficiary information on virtual asset transfers and to send it to the receiving provider.',
    source: 'The FATF Recommendations, updated October 2025: Recommendation 16 and the Interpretive Note to Recommendation 15, paragraph 7(b).',
    links: [['fatf-gafi.org', 'https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Fatf-recommendations.html']],
  },
  {
    n: 2,
    text: 'Since 30 December 2024, EU crypto-asset service providers must ensure that every crypto-asset transfer, whatever the amount, is accompanied by information on the originator and the beneficiary. For transfers above EUR 1,000 to or from a self-hosted wallet, they must take adequate measures to assess whether the wallet is owned or controlled by the originator (outgoing) or the beneficiary (incoming).',
    source: 'Regulation (EU) 2023/1113, Articles 14, 16 and 40.',
    links: [['eur-lex.europa.eu', 'https://eur-lex.europa.eu/eli/reg/2023/1113/oj']],
  },
  {
    n: 3,
    text: 'Since 9 October 2025, banks and payment providers in the euro area must check that the payee\'s name matches the IBAN before a euro credit transfer is authorised, and warn the payer if it does not.',
    source: 'Regulation (EU) 2024/886, Article 5c of Regulation (EU) No 260/2012; European Commission news, 10 October 2025.',
    links: [
      ['eur-lex.europa.eu', 'https://eur-lex.europa.eu/eli/reg/2024/886/oj'],
      ['finance.ec.europa.eu', 'https://finance.ec.europa.eu/news/new-eu-rules-make-instant-euro-payments-faster-and-safer-2025-10-10_en'],
    ],
  },
  {
    n: 4,
    text: 'Kazakhstani licensed digital-asset providers must collect and keep information on the sender and the recipient of digital-asset transfers. If that information is missing, they must suspend the operation and, if the client does not supply it, refuse it.',
    source: 'Law of the Republic of Kazakhstan No. 193-VII on digital assets, Article 12-1, paragraphs 8 and 9.',
    links: [['adilet.zan.kz', 'https://adilet.zan.kz/rus/docs/Z2300000193']],
  },
  {
    n: 5,
    text: 'In Kazakhstan, organising trade in unsecured digital assets such as cryptocurrencies is permitted only through exchange operators and trading platforms licensed or registered by the National Bank, or through licensed participants of the Astana International Financial Centre (AIFC), with a few statutory exceptions.',
    source: 'Law of the Republic of Kazakhstan No. 193-VII on digital assets, Article 12-1, paragraph 1.',
    links: [
      ['adilet.zan.kz', 'https://adilet.zan.kz/rus/docs/Z2300000193'],
      ['nationalbank.kz', 'https://nationalbank.kz/ru/page/digital-assets-legal-framework'],
    ],
  },
  {
    n: 6,
    text: 'Under Kazakhstan\'s anti-money laundering law, digital-asset service providers, including crypto exchange operators, trading platforms and issuers of digital financial assets, are subjects of financial monitoring and must carry out customer due diligence.',
    source: 'Law of the Republic of Kazakhstan No. 191-IV, Kazakhstan\'s anti-money laundering law, Articles 3 and 5.',
    links: [['adilet.zan.kz', 'https://adilet.zan.kz/rus/docs/Z090000191_']],
  },
  {
    n: 7,
    text: 'Kazakhstan has adopted a constitutional law on the special legal regime of Alatau City. It provides for its own regulation of digital assets, to be set by an act of the city administration agreed with the National Bank. The relevant articles take effect on 1 January 2027.',
    source: 'Constitutional Law of the Republic of Kazakhstan No. 286-VIII of 8 May 2026 on the special legal regime of Alatau City, Articles 47 and 90.',
    links: [
      ['adilet.zan.kz', 'https://adilet.zan.kz/rus/docs/Z2600000286'],
      ['akorda.kz', 'https://www.akorda.kz/ru/glavoy-gosudarstva-podpisan-konstitucionnyy-zakon-respubliki-kazahstan-o-specialnom-pravovom-rezhime-goroda-alatau-84383'],
    ],
  },
  {
    n: 8,
    text: 'Kazakhstan\'s president has described Alatau as the first crypto city in its part of the world and has announced plans for a CryptoCity pilot zone where cryptocurrencies could be used to pay for goods and services. These are announced plans, not rules in force.',
    source: 'Statements by the President of Kazakhstan at the meeting on the development of Alatau and at the Astana International Forum.',
    links: [
      ['akorda.kz', 'https://www.akorda.kz/ru/vystuplenie-glavy-gosudarstva-kasym-zhomarta-tokaeva-na-soveshchanii-po-razvitiyu-goroda-alatau-255039'],
      ['akorda.kz', 'https://www.akorda.kz/en/statement-by-he-president-of-the-republic-of-kazakhstan-mr-kassym-jomart-tokayev-at-the-plenary-session-of-the-astana-international-forum-2944235'],
    ],
  },
  {
    n: 9,
    text: 'In Kazakhstan, resident individuals who own digital assets on 31 December declare them in the annual declaration of income and property (form 270.00), where they list the exchange or wallet and the wallet address. The one-time declaration of assets and liabilities (form 250.00) also has a section for digital assets.',
    source: 'Tax Code of the Republic of Kazakhstan No. 214-VIII, Articles 417 and 423; Order of the Minister of Finance No. 695 of 12 November 2025, forms 270.00 and 250.00.',
    links: [
      ['adilet.zan.kz', 'https://adilet.zan.kz/rus/docs/K2500000214'],
      ['adilet.zan.kz', 'https://adilet.zan.kz/rus/docs/V2500037390'],
    ],
  },
]

// Сноски внизу секции; метки [n] в тексте ведут на якоря src-n
const Notes = defineComponent({
  props: { items: { type: Array as PropType<Note[]>, required: true } },
  setup: props => () => h('ol', { class: 'note mt-12 list-decimal gap-12 border-t border-line pl-5 pt-8', start: props.items[0]?.n }, props.items.map(f =>
    h('li', { id: `src-${f.n}`, key: f.n, class: 'mb-4 break-inside-avoid pl-1' }, [
      f.text,
      h('span', { class: 'mt-1 block' }, ['Source: ', f.source, ' ', ...f.links.flatMap(([label, url], i) => [
        i ? ' · ' : '',
        h('a', { href: url, target: '_blank', rel: 'noopener' }, label),
      ])]),
    ]),
  )),
})

const scenario = [
  'The state issues a token that moves only to sealed wallets.',
  'A verified company pays for a property. MOR checks the buyer and seller wallets.',
  'The receipt feeds an authorized reporting integration.',
]

const steps: { icon: string; title: string; text: string; artifact: string; seal?: string }[] = [
  {
    icon: 'step-sign',
    title: 'Sign',
    text: 'The company signs a short request with its electronic signature: an NCA key in Kazakhstan or an organization certificate in the EU.',
    artifact: 'MOR-SEAL-REQUEST-V1\nprogram: Cqbw…P1aP\naddress: Bp75…eALw\nkind: wallet\ncontroller: Bp75…eALw',
  },
  {
    icon: 'step-verify',
    title: 'Verify',
    text: 'An attestor checks a Kazakhstan signature off-chain, and the program verifies an EU certificate and signature on-chain.',
    artifact: '{ "name": "ТОО «Ромашка»",\n  "trustService": "Gfmd…EFnJ",\n  "identifierHash": "…",\n  "signature": "…" }',
  },
  {
    icon: 'step-seal',
    title: 'Register',
    text: 'The wallet controller registers the seal: the company name and a salted hash of its BIN or registry number go on-chain.',
    seal: '3iQx…fjaL',
    artifact: 'name ТОО «Ромашка»\njurisdiction KZ\ntrust level attested\nvalid until 30 Mar 2027',
  },
  {
    icon: 'step-check',
    title: 'Check',
    text: 'Any Solana program can check the seal; the Token-2022 transfer hook checks it on every transfer.',
    artifact: 'Program 2A8c…khz2 failed:\ncustom program error: 0x238c\n9100: recipient has no seal',
  },
]

const city = [
  { term: 'Organization seals', text: 'Companies seal their wallets with the electronic signatures they already hold. Each seal shows its trust level and who confirmed it.' },
  { term: 'Token rules', text: 'A Token-2022 transfer hook lets a state-issued token move only to wallets with a valid seal.' },
  { term: 'Reporting from the ledger', text: 'Reporting teams read transfers between sealed wallets from the chain, instead of collecting periodic reports.' },
]

const approaches = [
  ['Licensed exchanges', 'Customer onboarding', 'Exchange integration', 'Licensed operator'],
  ['KYB platforms, e.g. Sumsub', 'Documents and company registries', 'Provider API', 'Verification provider'],
  ['Attestations, e.g. EAS', 'Issuer-defined claims', 'Attestation schema', 'Attestation issuer'],
  ['MOR', 'Electronic signatures of organizations', 'Solana registry + Token-2022 hook', 'Trusted CAs + Kazakhstan attestor'],
]

const roadmap = [
  { label: 'Months 1 to 2', title: 'Pilot discovery', text: 'Interview public-sector and platform teams. Define reporting needs and regulatory scope.' },
  { label: 'Months 3 to 4', title: 'Security and integration', text: 'Improve revocation. Prepare audits and tests. Research ZK proofs for the planned privacy layer.' },
  { label: 'Months 5 to 6', title: 'Mainnet readiness', text: 'Prepare the mainnet launch. Complete the security review and required approvals. Run an approved pilot.' },
]

const team = [
  { name: 'David Torossyan', role: 'Technical co-founder', text: 'Cryptography and infrastructure. Security engineer at Gamma Technologies: PKCS#11, HSMs and key management.', telegram: 'dtorossyan' },
  { name: 'Abylaikhan Karsybayev', role: 'Product co-founder', text: 'Design and customer development. Startup and Web3 product focus.', telegram: 'ablStartup' },
]
</script>
