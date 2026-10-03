// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/fonts', '@nuxt/icon', '@nuxtjs/tailwindcss', '@nuxtjs/seo'],

  // Лендинг и оболочки страниц уходят в статический HTML, выписка читает devnet только в браузере
  ssr: true,
  nitro: { prerender: { routes: ['/', '/seal', '/transfer'], crawlLinks: false } },
  routeRules: { '/address/**': { ssr: false } },

  app: { head: { htmlAttrs: { lang: 'en' }, link: [{ rel: 'icon', type: 'image/svg+xml', href: '/img/mark.svg' }, { rel: 'icon', href: '/favicon.ico', sizes: '48x48' }] } },
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    name: 'MOR',
    description: 'MOR links a company to a Solana wallet with its electronic signature.',
    defaultLocale: 'en',
  },
  robots: { disallow: ['/address'] },
  ogImage: { defaults: { width: 1200, height: 630 }, fonts: ['Manrope:500', 'Manrope:700', 'Manrope:800'] },

  runtimeConfig: {
    public: {
      rpcUrl: 'https://api.devnet.solana.com',
      attestorUrl: 'http://127.0.0.1:8787',
      registry: 'CqbwC3DF4APG6cjRneir1UPuBbh49ttBrKasfc5QP1aP',
      hook: '2A8chB6zt4LCsiiks5NrY3DceHvAVqWkAmMdNpyFkhz2',
      mint: 'HQmD2eDfnR1rad38zPzrVcqa7h6iYBbvNuPTVn4ZVdDc',
      bondProgram: '37kyWEQCrscGU8dxhHPGpbxocH4azaZpc4FNip3zEqEv',
      tkztMint: 'Qukc9v9Wgwuzaa5gLtoh9n2P3o72fXcofLWVk5SVGJH',
      kaseReferenceMint: '95JPAUBgwwA1fhyeH1BQfrEwvSrfrfU9RU1quP2iCCQc',
      attestorAddress: 'DzEKM1bBSwg199FtSeqmeo7x2HD3kaCn7XBR7FvQcDmy',
      // fixtures/keys/attestor.json, TEST-ONLY: ключ опубликован, такую печать может поставить кто угодно
      testAttestorKey:
        'c5ef593e369d8cdab85c485061cc1160741c6d26f3da2404036b0efaffce7abdc0f567f08b7db041cd8b8a6696d73bc0e2ade1cd9c92d4aedd92e52f5cc40c68',
    },
  },

  fonts: {
    families: [
      { name: 'Manrope', provider: 'google', weights: [500, 700, 800] },
      { name: 'Geist Mono', provider: 'google', weights: [400, 500] },
    ],
  },
  icon: { serverBundle: { collections: ['ph'] }, clientBundle: { scan: true } },

  // В Nuxt 4 модуль ищет assets/css от корня, а не от app/, поэтому путь задан явно
  tailwindcss: { cssPath: '~/assets/css/tailwind.css' },
})
