import { expect, test } from '@playwright/test'
import { e2eAddress, withE2eWallet } from './helpers'

test.describe.configure({ mode: 'serial' })

test('the hook rejects a transfer to C before the wallet signs', async ({ page }) => {
  await withE2eWallet(page)
  await page.goto('/transfer')
  await expect(page.getByText(`Sender:`)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('balance:')).toContainText(/\d/, { timeout: 60_000 })
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
