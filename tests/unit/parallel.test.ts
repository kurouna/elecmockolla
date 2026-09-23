import { describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'
import type { MockConfig } from '../../src/shared/types.ts'

/**
 * Parallel slots must really run at the same time: N requests on N slots take as long as
 * one, and the server's own records show N generating at once. A hidden serialization
 * (a shared lock, one timer for all streams, a connection limit to Ollama) fails this.
 */
async function startServer(patch: Partial<MockConfig> = {}) {
  const instant = presetById('instant')
  if (!instant) throw new Error('no instant preset')
  const config: MockConfig = {
    ...applyPreset(defaultConfig(), instant),
    port: 0,
    // 20 tokens at 40 tok/s: half a second of streaming per request.
    ttftMs: 0,
    tps: 40,
    jitter: 0,
    loadMs: 0,
    ...patch,
  }
  const server = new MockServer({ config, rules: defaultRules() })
  return { server, url: await server.start() }
}

const TEXT = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ')

async function ask(url: string, stream: boolean): Promise<void> {
  const r = await fetch(`${url}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model: 'm',
      messages: [{ role: 'user', content: `/echo ${TEXT}` }],
      stream,
    }),
  })
  expect(r.status).toBe(200)
  await r.text()
}

/** Seconds for n requests sent together. */
async function wave(url: string, n: number, stream: boolean): Promise<number> {
  const t0 = performance.now()
  await Promise.all(Array.from({ length: n }, () => ask(url, stream)))
  return (performance.now() - t0) / 1000
}

/** The most requests generating at the same moment, from the server's records. */
function mostAtOnce(server: MockServer): number {
  const edges: [number, number][] = []
  for (const r of server.monitor.recent()) {
    if (!r.t.started || !r.t.ended) continue
    edges.push([r.t.started, 1], [r.t.ended, -1])
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let now = 0
  let most = 0
  for (const [, d] of edges) {
    now += d
    most = Math.max(most, now)
  }
  return most
}

describe('parallel slots', () => {
  for (const stream of [false, true])
    it(`answers as many requests at once as there are slots (stream: ${stream})`, async () => {
      const { server, url } = await startServer({ numParallel: 4 })
      try {
        const one = await wave(url, 1, stream)
        server.monitor.reset()
        const four = await wave(url, 4, stream)
        expect(mostAtOnce(server)).toBe(4)
        // Serial would be 4x; allow generous slack for a busy CI machine.
        expect(four).toBeLessThan(one * 1.8)

        server.monitor.reset()
        const eight = await wave(url, 8, stream)
        // Eight requests on four slots: two rounds, never more than four at once.
        expect(mostAtOnce(server)).toBe(4)
        expect(eight).toBeGreaterThan(one * 1.6)
      } finally {
        await server.stop()
      }
    })

  it('keeps them parallel through the proxy to Ollama', async () => {
    const up = await startServer({ numParallel: 4 })
    const proxy = await startServer({ numParallel: 4, mode: 'proxy', upstream: `${up.url}/v1` })
    try {
      await proxy.server.upstream.poll()
      const one = await wave(proxy.url, 1, true)
      up.server.monitor.reset()
      proxy.server.monitor.reset()
      const four = await wave(proxy.url, 4, true)
      expect(mostAtOnce(proxy.server)).toBe(4)
      expect(mostAtOnce(up.server)).toBe(4)
      expect(four).toBeLessThan(one * 1.8)
    } finally {
      await proxy.server.stop()
      await up.server.stop()
    }
  })
})
