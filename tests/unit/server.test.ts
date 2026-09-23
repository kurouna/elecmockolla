import { Ollama } from 'ollama'
import OpenAI from 'openai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'
import type { MockConfig } from '../../src/shared/types.ts'

async function startServer(patch: Partial<MockConfig> = {}) {
  const instant = presetById('instant')
  if (!instant) throw new Error('no instant preset')
  const config = { ...applyPreset(defaultConfig(), instant), port: 0, ...patch }
  const server = new MockServer({ config, rules: defaultRules() })
  const url = await server.start()
  return { server, url }
}

describe('Ollama API through the official client', () => {
  let server: MockServer
  let ollama: Ollama

  beforeAll(async () => {
    const s = await startServer()
    server = s.server
    ollama = new Ollama({ host: s.url })
  })
  afterAll(() => server.stop())

  it('lists, shows and reports the version', async () => {
    const tags = await ollama.list()
    expect(tags.models.map((m) => m.name)).toContain('llama3.2:3b')
    const show = await ollama.show({ model: 'qwen3:8b' })
    expect(show.capabilities).toContain('thinking')
    expect((await ollama.version()).version).toBe('0.12.0')
  })

  it('streams a chat reply chunk by chunk', async () => {
    const stream = await ollama.chat({
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })
    let text = ''
    let chunks = 0
    let last: { done: boolean; eval_count?: number; done_reason?: string } | undefined
    for await (const part of stream) {
      text += part.message.content
      chunks++
      last = part
    }
    expect(text.startsWith('hello!')).toBe(true)
    expect(chunks).toBeGreaterThan(5)
    expect(last).toMatchObject({ done: true, done_reason: 'stop' })
    expect(last?.eval_count).toBe(chunks - 1)
  })

  it('handles Japanese prompts, thinking and tool calls', async () => {
    const r = await ollama.chat({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: '大阪の天気は？' }],
      think: true,
    })
    expect(r.message.tool_calls?.[0]?.function).toMatchObject({
      name: 'get_weather',
      arguments: { city: '大阪' },
    })
    expect(r.message.thinking?.length).toBeGreaterThan(0)

    const q = await ollama.generate({ model: 'qwen3:8b', prompt: 'これは何？' })
    expect(q.response.startsWith('いい質問ですね。')).toBe(true)
  })

  it('honours num_predict and format', async () => {
    const r = await ollama.generate({
      model: 'm',
      prompt: 'long please',
      options: { num_predict: 5 },
    })
    expect(r.eval_count).toBe(5)
    expect(r.done_reason).toBe('length')
    const j = await ollama.generate({ model: 'm', prompt: 'anything', format: 'json' })
    expect(() => JSON.parse(j.response)).not.toThrow()
  })

  it('embeds', async () => {
    const r = await ollama.embed({ model: 'nomic-embed-text', input: ['one', 'two'] })
    expect(r.embeddings).toHaveLength(2)
    expect(r.embeddings[0]).toHaveLength(768)
  })

  it('pulls a new model into the list and shows it loaded after use', async () => {
    server.setConfig({ ...server.config, pullMs: 50 })
    const events: string[] = []
    for await (const p of await ollama.pull({ model: 'phi4:14b', stream: true }))
      events.push(p.status)
    expect(events.at(-1)).toBe('success')
    expect((await ollama.list()).models.map((m) => m.name)).toContain('phi4:14b')
    await ollama.generate({ model: 'phi4:14b', prompt: 'hi' })
    expect((await ollama.ps()).models.map((m) => m.name)).toContain('phi4:14b')
  })

  it('returns injected faults to the client', async () => {
    server.injectFault('error500')
    await expect(ollama.generate({ model: 'm', prompt: 'x' })).rejects.toThrow(/injected/)
    await expect(ollama.generate({ model: 'm', prompt: '/error' })).rejects.toThrow(/injected/)
  })
})

describe('OpenAI-compatible API through the official client', () => {
  let server: MockServer
  let openai: OpenAI

  beforeAll(async () => {
    const s = await startServer()
    server = s.server
    openai = new OpenAI({ baseURL: `${s.url}/v1`, apiKey: 'ollama', maxRetries: 0 })
  })
  afterAll(() => server.stop())

  it('completes and streams chat', async () => {
    const r = await openai.chat.completions.create({
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: '/echo ping' }],
    })
    expect(r.choices[0]?.message.content).toBe('ping')
    expect(r.usage?.completion_tokens).toBeGreaterThan(0)

    const stream = await openai.chat.completions.create({
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      stream_options: { include_usage: true },
    })
    let text = ''
    let usage = 0
    for await (const c of stream) {
      text += c.choices[0]?.delta.content ?? ''
      if (c.usage) usage = c.usage.completion_tokens
    }
    expect(text.startsWith('hello!')).toBe(true)
    expect(usage).toBeGreaterThan(0)
  })

  it('returns tool calls with string arguments', async () => {
    const r = await openai.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'weather in Tokyo' }],
    })
    const call = r.choices[0]?.message.tool_calls?.[0]
    expect(r.choices[0]?.finish_reason).toBe('tool_calls')
    expect(call?.type === 'function' && JSON.parse(call.function.arguments)).toMatchObject({
      city: 'Tokyo',
    })
  })

  it('lists models and embeds', async () => {
    const models = await openai.models.list()
    expect(models.data.map((m) => m.id)).toContain('gemma3:4b')
    const e = await openai.embeddings.create({
      model: 'nomic-embed-text',
      input: 'x',
      dimensions: 16,
    })
    expect(e.data[0]?.embedding).toHaveLength(16)
  })

  it('reports errors in the OpenAI shape', async () => {
    server.injectFault('error500')
    await expect(
      openai.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ status: 500 })
  })
})

describe('scheduling, timing and faults', () => {
  it('runs NUM_PARALLEL at once, queues the rest and 503s past the queue', async () => {
    const { server, url } = await startServer({ numParallel: 2, maxQueue: 1, ttftMs: 300 })
    try {
      const send = () =>
        fetch(`${url}/api/generate`, {
          method: 'POST',
          body: JSON.stringify({ model: 'm', prompt: '/echo x', stream: false }),
        })
      const all = [send(), send(), send(), send()]
      await new Promise((r) => setTimeout(r, 100))
      const snap = server.snapshot()
      expect(snap.slots.filter((s) => s.requestId !== null)).toHaveLength(2)
      expect(snap.queue).toHaveLength(1)
      const statuses = (await Promise.all(all)).map((r) => r.status).sort()
      expect(statuses).toEqual([200, 200, 200, 503])
      expect(server.snapshot().totals).toMatchObject({ completed: 3, rejected: 1 })
    } finally {
      await server.stop()
    }
  })

  it('paces tokens at roughly the configured rate', async () => {
    const { server, url } = await startServer({ tps: 50, ttftMs: 0 })
    try {
      const t0 = Date.now()
      const r = await fetch(`${url}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({
          model: 'm',
          prompt: '/echo aaa bbb ccc ddd eee fff ggg hhh iii jjj',
          stream: false,
        }),
      })
      const body = (await r.json()) as { eval_count: number }
      const elapsed = Date.now() - t0
      expect(body.eval_count).toBe(10)
      // 10 tokens at 50 tok/s = 200 ms. Timers are coarse on Windows, so allow a band.
      expect(elapsed).toBeGreaterThan(150)
      expect(elapsed).toBeLessThan(800)
    } finally {
      await server.stop()
    }
  })

  it('cuts the stream on a disconnect fault and sends garbage on malformed', async () => {
    const { server, url } = await startServer()
    try {
      server.injectFault('disconnect')
      const r = await fetch(`${url}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: 'm', prompt: 'a long answer please' }),
      })
      await expect(r.text()).rejects.toThrow()

      server.injectFault('malformed')
      const m = await fetch(`${url}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: 'm', prompt: 'a long answer please' }),
      })
      const lines = (await m.text()).trim().split('\n')
      expect(() => lines.map((l) => JSON.parse(l))).toThrow()
    } finally {
      await server.stop()
    }
  })

  it('records a request for the inspector and frees the slot when the client leaves', async () => {
    const { server, url } = await startServer({ ttftMs: 2000 })
    try {
      const ac = new AbortController()
      const p = fetch(`${url}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
        signal: ac.signal,
      }).catch(() => null)
      await new Promise((r) => setTimeout(r, 100))
      ac.abort()
      await p
      await new Promise((r) => setTimeout(r, 100))
      const snap = server.snapshot()
      expect(snap.active).toHaveLength(0)
      expect(snap.finished.at(-1)).toMatchObject({ state: 'aborted', api: 'chat' })
      expect(snap.slots.every((s) => s.requestId === null)).toBe(true)
    } finally {
      await server.stop()
    }
  })

  it('rejects unknown models in strict mode', async () => {
    const { server, url } = await startServer({ strictModels: true })
    try {
      const r = await fetch(`${url}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: 'nope:1b', prompt: 'x' }),
      })
      expect(r.status).toBe(404)
      expect(await r.json()).toMatchObject({ error: expect.stringContaining('not found') })
    } finally {
      await server.stop()
    }
  })

  it('exposes the control API', async () => {
    const { server, url } = await startServer()
    try {
      const t = await fetch(`${url}/_mock/test`, {
        method: 'POST',
        body: JSON.stringify({ prompt: 'hello' }),
      })
      expect(await t.json()).toMatchObject({ match: { id: 'greeting' } })
      const c = await fetch(`${url}/_mock/config`, {
        method: 'PATCH',
        body: JSON.stringify({ tps: 7 }),
      })
      expect(await c.json()).toMatchObject({ tps: 7 })
      const bad = await fetch(`${url}/_mock/rules`, {
        method: 'PUT',
        body: JSON.stringify({ rules: [{ match: { kind: 'regex', pattern: '(' }, response: {} }] }),
      })
      expect(bad.status).toBe(400)
    } finally {
      await server.stop()
    }
  })
})
