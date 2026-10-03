import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const badge = (page: Page, text: string) => page.getByTestId('status-badge').filter({ hasText: text })

test('opens the reference bond and switches to an unknown mint', async ({ page }) => {
  await page.goto('/kase')
  await page.getByRole('link', { name: 'Reference bond' }).first().click()
  await expect(badge(page, 'Redeemed')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Holders processed 3 of 3: complete').first()).toBeVisible()
  await expect(badge(page, 'Paid').first()).toBeVisible()
  // Адрес без облигации этой программы
  await page.goto('/kase/bond/5kSUuRK5wM5LN4SsGekAzk9mGQ78zRnpsMsq3skWP3eu')
  await expect(badge(page, 'No such bond')).toBeVisible({ timeout: 60_000 })
  await expect(badge(page, 'Redeemed')).toHaveCount(0)
})
