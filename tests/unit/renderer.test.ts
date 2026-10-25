import { describe, expect, it } from 'vitest'
import { sameData } from '../../src/renderer/lib/equal.ts'
import { waterfallMoving } from '../../src/renderer/lib/waterfall.ts'

// The editing pages ask sameData whether a draft still equals what main stored.
describe('sameData', () => {
  it('ignores the order of keys', () => {
    expect(sameData({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(sameData({ x: { a: 1, b: 2 } }, { x: { b: 2, a: 1 } })).toBe(true)
  })

  it('sees a rule as unchanged after an optional field is dropped and set again', () => {
    // What main stores: normalizeRule writes status, ttftMs, tps, fault in that order.
    const saved = { id: 'r1', enabled: true, status: '500', ttftMs: 10, fault: 'error500' }
    // What the editor leaves behind: setStatus deletes the key, so it comes back last.
    const draft: Record<string, unknown> = { ...saved }
    delete draft.status
    draft.status = '500'
    expect(Object.keys(draft)).not.toEqual(Object.keys(saved))
    expect(JSON.stringify(draft)).not.toBe(JSON.stringify(saved))
    expect(sameData(draft, saved)).toBe(true)
  })

  it('treats a missing key and an explicit undefined as the same unset field', () => {
    expect(sameData({ a: 1 }, { a: 1, fault: undefined })).toBe(true)
    expect(sameData({ a: 1, fault: undefined }, { a: 1 })).toBe(true)
  })

  it('still reports real edits', () => {
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameData({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(sameData({ a: 1 }, { a: '1' })).toBe(false)
    expect(sameData({ a: null }, { a: undefined })).toBe(false)
    expect(sameData({ r: { pattern: 'a' } }, { r: { pattern: 'b' } })).toBe(false)
  })

  it('compares arrays by position', () => {
    expect(sameData([1, { a: 1, b: 2 }], [1, { b: 2, a: 1 }])).toBe(true)
    expect(sameData([1, 2], [2, 1])).toBe(false)
    expect(sameData([1, 2], [1, 2, 3])).toBe(false)
    expect(sameData([1], { 0: 1 })).toBe(false)
  })

  it('handles the values a rules file actually holds', () => {
    expect(sameData(null, null)).toBe(true)
    expect(sameData(null, {})).toBe(false)
    expect(sameData('a', 'a')).toBe(true)
    expect(sameData(1, true)).toBe(false)
  })
})

// The dashboard's waterfall redraws every frame only while waterfallMoving says so.
describe('waterfallMoving', () => {
  const now = 100_000
  const ended = (msAgo: number) => ({ t: { ended: now - msAgo } })

  it('moves while a request runs, even with nothing in the history', () => {
    expect(waterfallMoving(1, [], now, 30)).toBe(true)
  })

  it('moves while a finished bar is still inside the window', () => {
    expect(waterfallMoving(0, [ended(60_000), ended(29_000)], now, 30)).toBe(true)
  })

  it('is still once every bar has left the window, or there never was one', () => {
    expect(waterfallMoving(0, [ended(31_000), ended(90_000)], now, 30)).toBe(false)
    expect(waterfallMoving(0, [], now, 30)).toBe(false)
    expect(waterfallMoving(0, [ended(31_000)], now, 60)).toBe(true)
  })
})
