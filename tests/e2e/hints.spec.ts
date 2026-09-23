import { expect, test } from '@playwright/test'
import { type Launched, launch, open } from './support.ts'

// Hints that point to another place name it as the UI does ("Chaos › Load generator")
// and take you there.
test.describe.configure({ mode: 'serial' })

let s: Launched

test.beforeAll(async () => {
  s = await launch()
})

test.afterAll(async () => {
  await s?.close()
})

test('the empty timeline links to the playground and to Chaos › Load generator', async () => {
  const idle = s.page.locator('.idle:has(.goto)')
  await expect(idle).toContainText('No traffic')
  const links = idle.locator('.goto')
  await expect(links).toHaveText(['Playground', 'Chaos › Load generator'])

  await links.nth(1).click()
  await expect(s.page.locator('nav .nav.on')).toContainText('Chaos')
  await expect(s.page.locator('#loadgen')).toBeInViewport()

  await open(s.page, 'Dashboard')
  await s.page.locator('.idle .goto').first().click()
  await expect(s.page.locator('nav .nav.on')).toContainText('Playground')
})

test('the recordings tab links to Settings › Recordings', async () => {
  await open(s.page, 'Rules')
  await s.page.locator('.top .seg button').last().click()
  const link = s.page.locator('.empty .goto')
  await expect(link).toHaveText('Settings › Recordings')
  await link.click()
  await expect(s.page.locator('nav .nav.on')).toContainText('Settings')
  await expect(s.page.locator('#sec-recordings')).toBeInViewport()
  expect(s.errors).toEqual([])
})
