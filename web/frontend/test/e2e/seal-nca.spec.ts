import { expect, test } from '@playwright/test'
import { address } from '@solana/kit'
import { attestWithTestKey, encodeAttestResponse } from '../../app/utils/attestation'
import { DEVNET_IDS, fromHex } from '../../app/utils/registry'
import { e2eAddress, withE2eWallet } from './helpers'

const KEY = fromHex('c5ef593e369d8cdab85c485061cc1160741c6d26f3da2404036b0efaffce7abdc0f567f08b7db041cd8b8a6696d73bc0e2ade1cd9c92d4aedd92e52f5cc40c68')

test('NCA path: NCALayer signs, the attestor answers, the wallet registers', async ({ page }) => {
  await withE2eWallet(page)
  const owner = address(await e2eAddress())
  let requestText = ''

  await page.routeWebSocket('wss://127.0.0.1:13579/', (ws) => {
    ws.onMessage((raw) => {
      const req = JSON.parse(String(raw))
      expect(req).toMatchObject({ module: 'kz.gov.pki.knca.commonUtils', method: 'createCAdESFromBase64' })
      expect([req.args[0], req.args[1], req.args[3]]).toEqual(['PKCS12', 'SIGNATURE', true])
      requestText = Buffer.from(req.args[2], 'base64').toString('utf8')
      ws.send(JSON.stringify({ result: { version: '1.4' } }))
      ws.send(JSON.stringify({ code: '200', responseObject: 'ZmFrZS1jbXM=' }))
    })
  })
  await page.route('**/v1/attest', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ cms: 'ZmFrZS1jbXM=' })
    // Аттестатор подписал бы ровно те expires/deadline, что в запросе
    const deadline = BigInt(/deadline: (\d+)/.exec(requestText)![1])
    const a = await attestWithTestKey(DEVNET_IDS, KEY, owner, 'E2E NCA LLP', '987654321098', deadline - 600n)
    await route.fulfill({ json: encodeAttestResponse(a) })
  })

  await page.goto('/seal')
  const already = page.getByText('This wallet is already sealed')
  await Promise.race([already.waitFor({ timeout: 60_000 }), page.getByText('2. Attestation').waitFor({ timeout: 60_000 })])
  if (await already.isVisible()) {
    await page.getByRole('button', { name: 'Revoke seal' }).click()
    await expect(page.getByText('2. Attestation')).toBeVisible({ timeout: 120_000 })
  }

  await expect(page.locator('fieldset pre')).toContainText(`address: ${owner}`)
  await page.getByRole('button', { name: 'Sign with NCALayer' }).click()
  await expect(page.getByText('Attested by')).toContainText('E2E NCA LLP, BIN 987654321098', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Register seal' }).click()
  await expect(page.getByRole('heading', { name: 'Seal registered' })).toBeVisible({ timeout: 120_000 })

  await page.goto('/seal')
  await expect(page.getByText('This wallet is already sealed as')).toContainText('E2E NCA LLP', { timeout: 60_000 })
  await page.getByRole('button', { name: 'Revoke seal' }).click()
  await expect(page.getByText('Seal revoked')).toBeVisible({ timeout: 120_000 })
})
