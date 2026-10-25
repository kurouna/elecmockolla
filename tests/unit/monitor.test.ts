import { describe, expect, it } from 'vitest'
import { Monitor, sanitizeBody } from '../../src/core/monitor.ts'

const start = (m: Monitor, body: unknown = { prompt: 'hi' }) =>
  m.create('generate', 'POST', '/api/generate', 'llama3.2:3b', false, body)

describe('Monitor', () => {
  it('counts a finished request once and hands it over to be sent', () => {
    const m = new Monitor()
    const logged: number[] = []
    m.onFinish = (r) => logged.push(r.id)
    m.finish(start(m), 'done')
    expect(m.totals).toMatchObject({ requests: 1, completed: 1, errors: 0 })
    expect(m.takeFinished().map((r) => r.id)).toEqual([1])
    expect(m.takeFinished()).toEqual([])
    expect(logged).toEqual([1])
  })

  it('ignores a second finish for the same request', () => {
    const m = new Monitor()
    const rec = start(m)
    m.finish(rec, 'done')
    m.finish(rec, 'error', 500)
    expect(m.totals).toMatchObject({ completed: 1, errors: 0 })
    expect(m.recent()).toHaveLength(1)
  })

  it('sorts a finish into the total it belongs to', () => {
    const m = new Monitor()
    m.finish(start(m), 'aborted')
    m.finish(start(m), 'error', 503)
    m.finish(start(m), 'error', 500)
    expect(m.totals).toMatchObject({ requests: 3, aborted: 1, rejected: 1, errors: 1 })
  })

  it('keeps, sends and logs a request that was running at a reset, without counting it', () => {
    const m = new Monitor()
    const logged: number[] = []
    m.onFinish = (r) => logged.push(r.id)
    const rec = start(m)
    m.reset()
    expect(m.totals.requests).toBe(0)
    m.finish(rec, 'done')
    // Not in these totals: the request was received before the reset.
    expect(m.totals).toMatchObject({ requests: 0, completed: 0 })
    // But it did finish, so the inspector and the CLI still hear about it.
    expect(m.recent().map((r) => r.id)).toEqual([rec.id])
    expect(m.takeFinished().map((r) => r.id)).toEqual([rec.id])
    expect(logged).toEqual([rec.id])
  })

  it('bounds what it keeps, carried requests included', () => {
    const m = new Monitor()
    const carried = Array.from({ length: 20 }, () => start(m))
    m.reset()
    for (const r of carried) m.finish(r, 'done')
    for (let i = 0; i < 600; i++) m.finish(start(m), 'done')
    expect(m.recent()).toHaveLength(500)
    expect(m.takeFinished()).toHaveLength(500)
  })

  it('cuts strings that would make a record huge, and keeps the shape', () => {
    const long = 'x'.repeat(9000)
    const out = sanitizeBody({ messages: [{ role: 'user', content: long }], keep: 1 }) as {
      messages: { role: string; content: string }[]
      keep: number
    }
    expect(out.keep).toBe(1)
    expect(out.messages[0]?.role).toBe('user')
    expect(out.messages[0]?.content).toContain('9000 chars')
    expect(out.messages[0]?.content.length).toBeLessThan(4100)
  })

  it('charts a second of traffic and leaves the idle seconds since at zero', () => {
    const m = new Monitor()
    const rec = start(m)
    m.addTokens(rec, 'a', false, 3)
    m.roll(Date.now() + 3000)
    expect(m.tps.slice(-3)).toEqual([3, 0, 0])
    expect(m.tps).toHaveLength(120)
  })
})
