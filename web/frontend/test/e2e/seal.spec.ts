import { expect, test } from '@playwright/test'
import { withE2eWallet } from './helpers'

test('seal the e2e wallet with the test attestor, then revoke', async ({ page }) => {
  await withE2eWallet(page)
  await page.goto('/seal')
  await expect(page.getByText('Connected:')).toBeVisible({ timeout: 30_000 })

  // Чистим след прошлого прогона
  const already = page.getByText('This wallet is already sealed')
  await Promise.race([already.waitFor({ timeout: 60_000 }), page.getByText('2. Attestation').waitFor({ timeout: 60_000 })])
  if (await already.isVisible()) {
    await page.getByRole('button', { name: 'Revoke seal' }).click()
    await expect(page.getByText('Seal revoked')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('2. Attestation')).toBeVisible({ timeout: 60_000 })
  }

  await page.getByLabel('Company name').fill('E2E Demo LLP')
  await page.getByLabel('BIN').fill('123456789012')
  await page.getByRole('button', { name: 'Sign with the test attestor' }).click()
  await expect(page.getByText('Attested by')).toContainText('E2E Demo LLP, BIN 123456789012')

  await page.getByRole('button', { name: 'Register seal' }).click()
  await expect(page.getByRole('heading', { name: 'Seal registered' })).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('code')).toHaveText(/^[0-9a-f]{64}$/)

  await page.goto('/seal')
  await expect(page.getByText('This wallet is already sealed as')).toContainText('E2E Demo LLP', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Revoke seal' }).click()
  await expect(page.getByText('Seal revoked')).toBeVisible({ timeout: 120_000 })
})
