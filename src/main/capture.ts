import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'

const PAGES = ['dashboard', 'requests', 'playground', 'rules', 'models', 'chaos', 'settings']
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Screenshot mode (MOCKOLLA_CAPTURE=<dir>, see scripts/screenshots.mjs):
 * generates some traffic, then saves a PNG of every page and quits.
 * Used for the README and for checking the UI without clicking through it.
 */
export async function capturePages(
  win: BrowserWindow,
  dir: string,
  startTraffic: () => void,
): Promise<void> {
  mkdirSync(dir, { recursive: true })
  win.showInactive()
  const js = (code: string) => win.webContents.executeJavaScript(code, true)
  const shot = async (name: string) => {
    // Force a fresh frame: capturePage returns the last painted one.
    win.webContents.invalidate()
    await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const img = await win.webContents.capturePage()
    writeFileSync(path.join(dir, `${name}.png`), img.toPNG())
  }
  const open = async (i: number) => {
    await js(`document.querySelectorAll('nav .nav')[${i}]?.click()`)
    await wait(700)
  }

  await wait(1500)
  startTraffic()
  await wait(3500)
  await open(0)
  await shot('dashboard')

  // Requests: select the newest one so the detail pane is filled.
  await open(1)
  await js(`document.querySelector('tbody tr.clickable')?.click()`)
  await wait(400)
  await shot('requests')

  for (const [i, name] of PAGES.entries()) {
    if (i < 3) continue
    await open(i)
    await shot(name)
    if (name === 'rules') {
      // The recordings tab: the last button of the tab bar.
      await js(`[...document.querySelectorAll('.top .seg button')].at(-1)?.click()`)
      await wait(400)
      await shot('recordings')
      await js(`document.querySelector('.top .seg button')?.click()`)
    }
    if (name === 'settings') {
      // The lower half: mock replies and recordings.
      await js(`document.querySelector('#sec-replies')?.scrollIntoView()`)
      await wait(300)
      await shot('settings-2')
    }
  }
  await open(0)
  await shot('dashboard-2')

  // Playground last, once the generated traffic has drained from the queue.
  await open(2)
  await js(`document.querySelector('button.send')?.click()`)
  for (let i = 0; i < 40; i++) {
    await wait(250)
    if (
      await js(
        `!document.querySelector('.caret') && !!document.querySelector('pre.text')?.textContent`,
      )
    )
      break
  }
  await wait(300)
  await shot('playground')

  // The light theme.
  await open(0)
  await js(`[...document.querySelectorAll('nav .nav')].at(-1)?.click()`)
  await wait(600)
  await shot('dashboard-light')
  await js(`[...document.querySelectorAll('nav .nav')].at(-1)?.click()`)
}
