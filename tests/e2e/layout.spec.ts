/// <reference lib="dom" />
import { expect, type Page, test } from '@playwright/test'
import { type Launched, launch } from './support.ts'

/**
 * Every control can be clicked and nothing is cut off or squashed, on every page, at the
 * smallest window the app allows (960 x 620) and at its default size, in both languages.
 * Found before: a mode chip hidden under the window controls, a message that could not be
 * clicked, a squashed filter, buttons cut off at the edge of their panel.
 */

/** Runs in the page: what is wrong on screen now. */
function inspect(): string[] {
  const out: string[] = []
  const vw = document.documentElement.clientWidth
  const vh = document.documentElement.clientHeight
  const name = (el: Element) => {
    const t = (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      el.getAttribute('placeholder') ||
      ''
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40)
    return `${el.tagName.toLowerCase()} "${t}"`
  }
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return (
      r.width > 0 &&
      r.height > 0 &&
      cs.visibility !== 'hidden' &&
      r.bottom > 0 &&
      r.top < vh &&
      r.right > 0 &&
      r.left < vw
    )
  }
  const controls = document.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [role="button"], [role="radio"]',
  )
  for (const el of controls) {
    if (!shown(el) || (el as HTMLButtonElement).disabled) continue
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    // Scrolled out of a scrolling panel is fine; cut off by a clipping box is not.
    let skip = false
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a)
      const ar = a.getBoundingClientRect()
      if (cx >= ar.left && cx <= ar.right && cy >= ar.top && cy <= ar.bottom) continue
      if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) skip = true
      else if (/hidden|clip/.test(cs.overflowX + cs.overflowY)) {
        out.push(`cut off: ${name(el)}`)
        skip = true
      }
      if (skip) break
    }
    if (skip) continue
    const hit = document.elementFromPoint(cx, cy)
    const ok =
      hit &&
      (el === hit || el.contains(hit) || hit.contains(el) || el.closest('label')?.contains(hit))
    if (!ok) out.push(`covered: ${name(el)} by ${hit ? name(hit) : 'nothing'}`)
    if (getComputedStyle(el).pointerEvents === 'none') out.push(`not clickable: ${name(el)}`)
    // Windows draws its caption buttons over the top-right corner.
    if (r.top < 40 && r.right > vw - 140) out.push(`under the window controls: ${name(el)}`)
    const text =
      el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' &&
        !['checkbox', 'radio', 'range'].includes((el as HTMLInputElement).type))
    if (text && r.width < 60) out.push(`squashed: ${name(el)}`)
  }
  if (document.documentElement.scrollWidth > vw + 1) out.push('the page scrolls sideways')
  // Text spilling out of a box that does not scroll.
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    if (!shown(el)) continue
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())
    if (!own) continue
    const cs = getComputedStyle(el)
    if (/(auto|scroll)/.test(cs.overflowX) || cs.textOverflow === 'ellipsis') continue
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0)
      out.push(`text spills: ${name(el)}`)
  }
  return [...new Set(out)]
}

async function check(page: Page, where: string): Promise<string[]> {
  return (await page.evaluate(inspect)).map((p) => `${where}: ${p}`)
}

for (const lang of ['en', 'ja'] as const) {
  test.describe(`layout (${lang})`, () => {
    test.describe.configure({ mode: 'serial' })
    let s: Launched
    test.beforeAll(async () => {
      s = await launch(lang)
      // Rows for the tables and charts.
      for (const p of ['hello', '/json', '/error 429', '/markdown'])
        await fetch(`${s.url}/api/chat`, {
          method: 'POST',
          body: JSON.stringify({
            model: 'llama3.2:3b',
            messages: [{ role: 'user', content: p }],
            stream: false,
          }),
        })
    })
    test.afterAll(async () => {
      await s?.close()
    })

    for (const [w, h] of [
      [960, 620],
      [1360, 880],
    ] as const)
      test(`every page at ${w} x ${h}`, async () => {
        await s.app.evaluate(
          ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(...size),
          [w, h] as [number, number],
        )
        const problems: string[] = []
        const pages = s.page.locator('nav .nav:not(.theme)')
        const n = await pages.count()
        for (let i = 0; i < n; i++) {
          await pages.nth(i).click()
          await s.page.waitForTimeout(300)
          const where = (await pages.nth(i).innerText()).trim()
          problems.push(...(await check(s.page, where)))
          // The other tabs of the Rules page.
          const tabs = s.page.locator('.top .seg button')
          for (let j = 1; j < (await tabs.count()); j++) {
            await tabs.nth(j).click()
            problems.push(...(await check(s.page, `${where} tab ${j}`)))
          }
          if (await tabs.count()) await tabs.first().click()
        }
        expect(problems).toEqual([])
      })
  })
}
