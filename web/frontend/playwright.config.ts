import { defineConfig } from '@playwright/test'

// Все e2e ходят в devnet и делят один демо-кошелёк, поэтому один воркер и щедрые таймауты
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://localhost:3000', viewport: { width: 1280, height: 900 } },
  webServer: { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
})
