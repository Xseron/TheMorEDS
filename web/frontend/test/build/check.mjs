// После pnpm generate: индексируемый HTML, карточка ссылки, sitemap и robots на месте
import { existsSync, readFileSync } from 'node:fs'

const out = new URL('../../.output/public/', import.meta.url)
const read = p => readFileSync(new URL(p, out), 'utf8')
const must = (cond, msg) => { if (!cond) { console.error('FAIL', msg); process.exitCode = 1 } else console.log('ok  ', msg) }

const index = read('index.html')
must(/<title>On-chain KYC for companies on Solana [|-] MOR<\/title>/.test(index), 'title')
must(/<meta name="description" content="MOR links a company/.test(index), 'description')
must(/property="og:image" content="[^"]+\/_og\/[^"]+\.png"/.test(index), 'og:image')
must(/property="og:title" content="MOR: on-chain KYC with electronic signatures"/.test(index), 'og:title')
must(index.includes('The wallet identity gap') && index.includes('Existing approaches and MOR'), 'landing text is prerendered')
must(/"@type":(\[[^\]]*)?"FAQPage"/.test(index) && /"@type":"Organization"/.test(index), 'JSON-LD')
must(/<html[^>]*lang="en"/.test(index), 'lang')
must((index.match(/<h1[\s>]/g) ?? []).length === 1, 'one h1')
must(existsSync(new URL('seal/index.html', out)) && existsSync(new URL('transfer/index.html', out)), 'seal and transfer prerendered')
must(read('robots.txt').includes('Disallow: /address'), 'robots disallows /address')
must(read('sitemap.xml').includes('/seal') && !read('sitemap.xml').includes('/address/'), 'sitemap')

const og = index.match(/property="og:image" content="([^"]+)"/)?.[1] ?? ''
const ogPath = og.replace(/^https?:\/\/[^/]+/, '')
must(ogPath.startsWith('/') && existsSync(new URL('.' + ogPath, out)), 'og image file exists in the output')
