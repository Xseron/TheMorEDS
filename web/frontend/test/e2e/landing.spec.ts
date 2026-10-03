import { expect, test } from '@playwright/test'

test('landing shows the live extract of B, the ledger toggle works, the form navigates, no horizontal scroll at 400px', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Who stands behind this Solana address?')
  // Название ещё есть в ссылке «Try:» и в артефактах шагов, поэтому ждём именно заголовок выписки
  await expect(page.getByRole('heading', { name: 'ТОО «Ромашка»' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('seal-status').first()).toHaveText('Valid seal')

  await expect(page.getByText('Alatau Build LLP')).toHaveCount(0)
  await page.getByRole('radio', { name: 'With seals' }).click()
  await expect(page.getByText('Alatau Build LLP').first()).toBeVisible()
  await expect(page.getByText('no seal', { exact: true }).first()).toBeVisible()

  await page.getByLabel('Solana address').fill('5kSUuRK5wM5LN4SsGekAzk9mGQ78zRnpsMsq3skWP3eu')
  await page.getByRole('button', { name: 'Check address' }).click()
  await expect(page).toHaveURL(/\/address\/5kSU/)

  await page.setViewportSize({ width: 400, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})
