import { defineConfig } from '@playwright/test'

// Порт задаётся E2E_PORT, чтобы не подхватить dev-сервер из другой копии репозитория
const port = process.env.E2E_PORT ?? '3000'

// Все e2e ходят в devnet и делят один демо-кошелёк, поэтому один воркер и щедрые таймауты
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 900 } },
  webServer: { command: `pnpm dev --port ${port}`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 120_000 },
})
