import { expect, test } from '@playwright/test'

const B = 'Bp75o5N39Zs2Qz7xseSSHVEKT8yAw8YEVxTQ48ZBeALw'
const C = '5kSUuRK5wM5LN4SsGekAzk9mGQ78zRnpsMsq3skWP3eu'

test('B: attested seal by the test attestor', async ({ page }) => {
  await page.goto(`/address/${B}`)
  await expect(page.getByText('ТОО «Ромашка»')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('img', { name: 'Registry seal: valid' })).toBeVisible()
  await expect(page.getByText('Mor Test Attestor, attestor, KZ')).toBeVisible()
  await expect(page.getByText('TEST', { exact: true })).toBeVisible()
  await expect(page.getByText('Certificate', { exact: true })).toHaveCount(0)
})

test('C: no seal', async ({ page }) => {
  await page.goto(`/address/${C}`)
  await expect(page.getByRole('img', { name: 'Stamp: NO SEAL' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('The registry does not know who stands behind this address')).toBeVisible()
})

test('junk is not an address', async ({ page }) => {
  await page.goto('/address/hello%20world')
  await expect(page.getByRole('img', { name: 'Stamp: NOT AN ADDRESS' })).toBeVisible()
  await expect(page.getByText('This is not a Solana address.')).toBeVisible()
})
