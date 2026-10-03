import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { E2E_SEED, withE2eWallet } from './helpers'

test.describe.configure({ mode: 'serial' })

const badge = (page: Page, text: string) => page.getByTestId('status-badge').filter({ hasText: text })

test('opens the reference bond and switches to an unknown mint', async ({ page }) => {
  await page.goto('/kase')
  await page.getByRole('link', { name: 'Reference bond' }).first().click()
  await expect(badge(page, 'Redeemed')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('Holders processed 3 of 3: complete').first()).toBeVisible()
  await expect(badge(page, 'Paid').first()).toBeVisible()
  // Nuxt пересоздаёт страницу при смене параметра маршрута, поэтому ответ старого минта не доживает до новой; здесь проверяем вид неизвестного минта
  // Адрес без облигации этой программы
  await page.goto('/kase/bond/5kSUuRK5wM5LN4SsGekAzk9mGQ78zRnpsMsq3skWP3eu')
  await expect(badge(page, 'No such bond')).toBeVisible({ timeout: 60_000 })
  await expect(badge(page, 'Redeemed')).toHaveCount(0)
})

test('a full lifecycle with a one-minute period', async ({ page }) => {
  test.setTimeout(900_000)
  await withE2eWallet(page)
  // Одни и те же демо-инвесторы в каждом прогоне: после первого они уже с SOL и печатью
  const investorSeeds = [1, 2, 3].map(i => createHash('sha256').update(`${E2E_SEED}:kase-investor-${i}`).digest('hex'))
  await page.addInitScript((seeds: string[]) => seeds.forEach((s, i) => localStorage.setItem(`kase-investor-${i + 1}`, s)), investorSeeds)
  await page.goto('/kase')
  await expect(page.getByText('Issuer:')).toBeVisible({ timeout: 30_000 })
  const seal = page.getByRole('button', { name: 'Seal with the test attestor' })
  // Ждём конца проверки печати: либо уже запечатан, либо появилась кнопка
  await expect(page.getByText('Sealed as').or(seal)).toBeVisible({ timeout: 60_000 })
  if (await seal.isVisible()) {
    await seal.click()
    await expect(page.getByText('Sealed as')).toBeVisible({ timeout: 120_000 })
  }
  const prepare = page.getByRole('button', { name: 'Prepare investors' })
  await expect(prepare).toBeEnabled({ timeout: 60_000 })
  await prepare.click()
  await expect(page.getByTestId('investor-status').filter({ hasText: 'No seal yet' })).toHaveCount(0, { timeout: 180_000 })
  await page.getByLabel('1 minute').check()
  await expect(page.getByRole('button', { name: 'Issue bond' })).toBeEnabled({ timeout: 180_000 })
  await page.getByRole('button', { name: 'Issue bond' }).click()
  await expect(page).toHaveURL(/\/kase\/bond\//, { timeout: 180_000 })

  await page.getByRole('button', { name: 'Announce 30% redemption' }).click()
  await expect(page.getByText('Partial redemption 30%')).toBeVisible({ timeout: 60_000 })

  for (const k of [1, 2, 3, 4]) {
    const snapshots = page.getByRole('button', { name: `Take snapshots for event ${k}` })
    await expect(snapshots).toBeEnabled({ timeout: 180_000 })
    if (k === 2) {
      await page.getByRole('button', { name: 'Send 1 bond: Investor 1 → Investor 2' }).click()
      await expect(page.getByText('not snapshotted for the current event (6008)')).toBeVisible({ timeout: 60_000 })
      await expect(page.getByTestId('seal-status')).toHaveText('Rejected')
    }
    await snapshots.click()
    await expect(page.getByText('Holders processed 3 of 3: complete').nth(k - 1)).toBeVisible({ timeout: 90_000 })
    if (k === 2) {
      await page.getByRole('button', { name: 'Send 1 bond: Investor 1 → Investor 2' }).click()
      await expect(page.getByText('Transfer passed')).toBeVisible({ timeout: 90_000 })
    }
    if (k === 1) {
      await page.getByRole('button', { name: 'Send 1 bond to C (no seal)' }).click()
      await expect(page.getByText('recipient has no seal (9100)')).toBeVisible({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Get tKZT' }).click()
      await expect(page.getByText('tKZT received')).toBeVisible({ timeout: 90_000 })
    }
    await page.getByRole('button', { name: `Fund event ${k}` }).click()
    const pay = page.getByRole('button', { name: `Pay all for event ${k}` })
    await expect(pay).toBeEnabled({ timeout: 120_000 })
    await pay.click()
    // После выплаты неоплаченных снимков нет, кнопка события исчезает
    await expect(pay).toBeHidden({ timeout: 90_000 })
  }
  await expect(badge(page, 'Redeemed')).toBeVisible({ timeout: 60_000 })
})
