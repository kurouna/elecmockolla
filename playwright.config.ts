import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // One Electron app at a time: each spec starts its own, with its own folder and port.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
  },
})
