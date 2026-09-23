import { expect, test } from '@playwright/test'
import { type Launched, launch, open } from './support.ts'

// One app for the whole file, driven page by page like a person would.
test.describe.configure({ mode: 'serial' })

let s: Launched

test.beforeAll(async () => {
  s = await launch()
})

test.afterAll(async () => {
  await s?.close()
})

test('the window opens, the mock answers and the title bar shows its URL', async () => {
  await expect(s.page).toHaveTitle('elecmockolla · Mock')
  const version = (await (await fetch(`${s.url}/api/version`)).json()) as { version: string }
  expect(version.version).toMatch(/^\d+\.\d+\.\d+$/)
  await expect(s.page.locator('button.url').first()).toContainText(s.url)
})

test('the renderer has no Node and only the mockolla bridge', async () => {
  const exposure = await s.page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>).require,
    process: typeof (globalThis as Record<string, unknown>).process,
    bridge: typeof (globalThis as Record<string, unknown>).mockolla,
  }))
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', bridge: 'object' })
})

test('every page opens without errors', async () => {
  for (const name of [
    'Dashboard',
    'Requests',
    'Playground',
    'Rules',
    'Models',
    'Chaos',
    'Settings',
  ]) {
    await open(s.page, name)
    await expect(s.page.locator('nav .nav.on')).toContainText(name)
  }
  await open(s.page, 'Dashboard')
  expect(s.errors).toEqual([])
})

test('the playground sends a prompt and shows the reply', async () => {
  await open(s.page, 'Playground')
  await s.page.locator('textarea').nth(1).fill('/echo hello from e2e')
  await s.page.locator('button.send').click()
  await expect(s.page.locator('pre.text')).toHaveText('hello from e2e')
})

test('requests from outside show up in the inspector', async () => {
  const r = await fetch(`${s.url}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: 'llama3.2:3b', prompt: '/echo from outside', stream: false }),
  })
  expect(((await r.json()) as { response: string }).response).toBe('from outside')
  await open(s.page, 'Requests')
  const row = s.page.locator('tbody tr', { hasText: '/api/generate' }).first()
  await expect(row).toContainText('200')
  await row.click()
  await expect(s.page.getByText('from outside').first()).toBeVisible()
})

test('the rule tester starts empty and shows the rule a prompt hits', async () => {
  await open(s.page, 'Rules')
  const input = s.page.locator('.tester input').first()
  await expect(input).toHaveValue('')
  await expect(s.page.locator('.item.hit')).toHaveCount(0)
  await input.fill('hello')
  await expect(s.page.locator('.item.hit')).toContainText('Greeting')
  await input.fill('')
  await expect(s.page.locator('.item.hit')).toHaveCount(0)
})

test('arrow keys move the mode choice in Settings', async () => {
  await open(s.page, 'Settings')
  const radio = (name: string) => s.page.getByRole('radio', { name: new RegExp(`^${name}`) })
  await radio('Mock').focus()
  await s.page.keyboard.press('ArrowRight')
  await expect(radio('Proxy')).toHaveAttribute('aria-checked', 'true')
  await expect(radio('Proxy')).toBeFocused()
  await s.page.keyboard.press('End')
  await expect(radio('Mixed')).toHaveAttribute('aria-checked', 'true')
  await s.page.keyboard.press('ArrowRight')
  await expect(radio('Mock')).toHaveAttribute('aria-checked', 'true')
  await expect(radio('Mock')).toBeFocused()
  // Only the chosen one is a tab stop.
  await expect(radio('Proxy')).toHaveAttribute('tabindex', '-1')
})

test('a fault injected from the Chaos page reaches the next request', async () => {
  await open(s.page, 'Chaos')
  await s.page
    .locator('.fault', { hasText: 'HTTP 500' })
    .getByRole('button', { name: '×1' })
    .click()
  await expect(s.page.locator('.pending .chip')).toHaveCount(1)
  const r = await fetch(`${s.url}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({ model: 'llama3.2:3b', prompt: 'hi', stream: false }),
  })
  expect(r.status).toBe(500)
  await expect(s.page.locator('.pending .chip')).toHaveCount(0)
  expect(s.errors).toEqual([])
})
