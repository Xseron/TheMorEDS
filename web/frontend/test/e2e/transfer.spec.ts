import { expect, test } from '@playwright/test'
import { e2eAddress, withE2eWallet } from './helpers'

test.describe.configure({ mode: 'serial' })

test('the hook rejects a transfer to C before the wallet signs', async ({ page }) => {
  await withE2eWallet(page)
  await page.goto('/transfer')
  await expect(page.getByText(`Sender:`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('balance:')).toContainText(/\d/, { timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Get demo tokens' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Send 1 token to C (no seal)' }).click()
  await expect(page.getByTestId('seal-status')).toHaveText('Rejected', { timeout: 60_000 })
  await expect(page.getByText('recipient has no seal (9100)')).toBeVisible()
})

test('a transfer to B passes and the balance drops by one', async ({ page }) => {
  await withE2eWallet(page)
  await page.goto('/transfer')
  const balance = page.locator('p', { hasText: 'balance:' }).locator('b')
  await expect(balance).toHaveText(/^\d+$/, { timeout: 60_000 })
  const before = Number(await balance.textContent())
  expect(before, `fund ${await e2eAddress()} from WSL first`).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Send 1 token to B (Kazakhstan)' }).click()
  await expect(page.getByText('Transfer passed')).toBeVisible({ timeout: 120_000 })
  await expect(balance).toHaveText(String(before - 1), { timeout: 60_000 })
})

test('an empty wallet gets the faucet button above the WSL commands', async ({ page }) => {
  // Свежий пустой кошелёк, кран подменён: настоящий сервис из e2e не зовём
  const seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
  await page.addInitScript((s: string) => {
    localStorage.setItem('mor-demo-seed', s)
    localStorage.setItem('mor-wallet', 'Built-in demo wallet')
  }, seed)
  const replies = [{ ok: true, signature: 'stub', sol: 0.05, tokens: 50 }, { ok: true, already: true }]
  await page.route('**/api/drip', async (route) => {
    await new Promise(r => setTimeout(r, 1500))
    await route.fulfill({ json: replies.shift(), headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto('/transfer')
  const button = page.getByRole('button', { name: 'Get demo tokens' })
  await button.click({ timeout: 60_000 })
  await expect(page.getByText('Funding this wallet with devnet SOL and demo tokens…')).toBeVisible()
  await expect(page.getByText('Devnet SOL and demo tokens sent')).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(page.getByText('This wallet already received demo tokens')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Get demo tokens above, or fund it from WSL')).toBeVisible()
})
