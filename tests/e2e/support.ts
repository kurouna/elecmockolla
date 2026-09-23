import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** A port nothing listens on right now, so the mock never meets a real Ollama. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close(() => resolve(port))
    })
  })
}

export interface Launched {
  app: ElectronApplication
  page: Page
  /** The mock's base URL, e.g. http://127.0.0.1:53124 */
  url: string
  /** Errors thrown in the renderer or logged to its console. */
  errors: string[]
  close: () => Promise<void>
}

/**
 * Starts the built app (`npm run build` first) with its own settings folder and port,
 * in the given language (English by default), and waits until the mock answers.
 */
export async function launch(lang: 'en' | 'ja' = 'en'): Promise<Launched> {
  // A long path with no spaces, like a macOS temp folder: paths shown in the UI must wrap.
  const root = mkdtempSync(path.join(tmpdir(), 'mockolla-e2e-'))
  const home = path.join(
    root,
    'a_settings_folder_path_with_no_spaces_to_break_at_like_macos_var_folders',
  )
  mkdirSync(home, { recursive: true })
  const port = await freePort()
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MOCKOLLA_HOME: home,
      MOCKOLLA_PORT: String(port),
      MOCKOLLA_LANG: lang,
      // Quick replies, and the same ones every run.
      MOCKOLLA_TTFT_MS: '0',
      MOCKOLLA_TPS: '0',
      MOCKOLLA_SEED: '1',
    },
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.waitForLoadState('domcontentloaded')
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(`${url}/api/version`).then(
      (r) => r.ok,
      () => false,
    )
    if (ok) break
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    app,
    page,
    url,
    errors,
    close: async () => {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** Opens a page from the sidebar by its English name. */
export async function open(page: Page, name: string): Promise<void> {
  await page.locator('nav .nav', { hasText: name }).first().click()
}
