import { Ollama } from 'ollama'
import OpenAI from 'openai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'
import type { MockConfig, RulesFile } from '../../src/shared/types.ts'

async function startServer(patch: Partial<MockConfig> = {}) {
  const instant = presetById('instant')
  if (!instant) throw new Error('no instant preset')
  const config = { ...applyPreset(defaultConfig(), instant), port: 0, seed: 3, ...patch }
  const server = new MockServer({ config, rules: defaultRules() })
  return { server, url: await server.start() }
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

describe('model management, as Ollama does it', () => {
  let server: MockServer
  let url: string
  let ollama: Ollama
  beforeAll(async () => {
    ;({ server, url } = await startServer({ strictModels: true }))
    ollama = new Ollama({ host: url })
  })
  afterAll(() => server.stop())

  const names = async () => (await ollama.list()).models.map((m) => m.name)

  it('creates, copies and deletes models', async () => {
    await ollama.create({ model: 'made:1b', from: 'llama3.2:3b', stream: false })
    expect(await names()).toContain('made:1b')
    await ollama.copy({ source: 'made:1b', destination: 'copy:1b' })
    expect(await names()).toContain('copy:1b')
    await ollama.delete({ model: 'made:1b' })
    expect(await names()).not.toContain('made:1b')
    await expect(ollama.delete({ model: 'made:1b' })).rejects.toThrow(/not found/)
    await expect(ollama.copy({ source: 'nope:1b', destination: 'x:1b' })).rejects.toThrow(
      /not found/,
    )
  })

  it('streams the steps of a create', async () => {
    const steps: string[] = []
    for await (const p of await ollama.create({ model: 'streamed:1b', stream: true }))
      steps.push(p.status)
    expect(steps.at(-1)).toBe('success')
  })

  it('answers 404 for an unknown model when strict', async () => {
    await expect(ollama.show({ model: 'nope:1b' })).rejects.toThrow(/not found/)
    await expect(ollama.generate({ model: 'nope:1b', prompt: 'hi' })).rejects.toThrow(/not found/)
    expect((await fetch(`${url}/v1/models/nope:1b`)).status).toBe(404)
    const one = (await (await fetch(`${url}/v1/models/llama3.2:3b`)).json()) as { id: string }
    expect(one.id).toBe('llama3.2:3b')
  })

  it('loads and unloads a model with an empty prompt', async () => {
    const ps = async () => (await ollama.ps()).models.map((m) => m.name)
    const load = await ollama.generate({ model: 'gemma3:4b', prompt: '' })
    expect(load.done_reason).toBe('load')
    expect(await ps()).toContain('gemma3:4b')
    const unload = await ollama.generate({ model: 'gemma3:4b', prompt: '', keep_alive: 0 })
    expect(unload.done_reason).toBe('unload')
    expect(await ps()).not.toContain('gemma3:4b')
    const chat = await ollama.chat({ model: 'gemma3:4b', messages: [] })
    expect(chat.done_reason).toBe('load')
  })

  it('answers the small endpoints clients probe', async () => {
    expect((await fetch(`${url}/api/blobs/sha256:abc`, { method: 'HEAD' })).status).toBe(200)
    const missing = await fetch(`${url}/api/nothing-here`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('404 page not found')
  })
})

describe('OpenAI-compatible extras', () => {
  let server: MockServer
  let openai: OpenAI
  beforeAll(async () => {
    const s = await startServer()
    server = s.server
    openai = new OpenAI({ baseURL: `${s.url}/v1`, apiKey: 'ollama', maxRetries: 0 })
  })
  afterAll(() => server.stop())

  it('serves the legacy completions API, streamed or not, with usage', async () => {
    const r = await openai.completions.create({ model: 'm', prompt: '/echo legacy works' })
    expect(r.object).toBe('text_completion')
    expect(r.choices[0]?.text).toBe('legacy works')
    expect(r.usage?.completion_tokens).toBeGreaterThan(0)

    const stream = await openai.completions.create({
      model: 'm',
      prompt: '/echo streamed legacy',
      stream: true,
      stream_options: { include_usage: true },
    })
    let text = ''
    let usage = 0
    for await (const c of stream) {
      text += c.choices[0]?.text ?? ''
      if (c.usage) usage = c.usage.completion_tokens
    }
    expect(text).toBe('streamed legacy')
    expect(usage).toBeGreaterThan(0)
  })

  it('returns JSON for response_format json_object and json_schema', async () => {
    const obj = await openai.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'tell me something' }],
      response_format: { type: 'json_object' },
    })
    expect(() => JSON.parse(obj.choices[0]?.message.content ?? '')).not.toThrow()

    const schema = await openai.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'a person' }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'person',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'integer' } },
            required: ['name', 'age'],
          },
        },
      },
    })
    const person = JSON.parse(schema.choices[0]?.message.content ?? '') as Record<string, unknown>
    expect(typeof person.name).toBe('string')
    expect(Number.isInteger(person.age)).toBe(true)
  })
})

describe('faults on embeddings', () => {
  it('drops or breaks the one JSON document an embedding is', async () => {
    const { server, url } = await startServer()
    try {
      server.injectFault('disconnect')
      await expect(fetch(`${url}/api/embed`, json({ model: 'e', input: 'x' }))).rejects.toThrow()
      server.injectFault('malformed')
      const broken = await fetch(`${url}/api/embed`, json({ model: 'e', input: 'x' }))
      const text = await broken.text()
      expect(() => JSON.parse(text)).toThrow()
      const last = server.monitor.recent().at(-1)
      expect(last).toMatchObject({ state: 'error', fault: 'malformed' })
    } finally {
      await server.stop()
    }
  })
})

describe('the control API', () => {
  let server: MockServer
  let url: string
  const changes: { config?: MockConfig; rules?: RulesFile }[] = []
  beforeAll(async () => {
    ;({ server, url } = await startServer())
    server.onControlChange = (c) => changes.push(c)
  })
  afterAll(() => server.stop())

  it('reports status, config and rules', async () => {
    const status = (await (await fetch(`${url}/_mock/status`)).json()) as {
      slots: unknown[]
      totals: unknown
    }
    expect(status.slots).toHaveLength(server.config.numParallel)
    expect(status.totals).toBeDefined()
    const config = (await (await fetch(`${url}/_mock/config`)).json()) as MockConfig
    expect(config.port).toBe(server.config.port)
    const rules = (await (await fetch(`${url}/_mock/rules`)).json()) as RulesFile
    expect(rules.rules.length).toBe(defaultRules().rules.length)
    const rec = (await (await fetch(`${url}/_mock/recordings`)).json()) as { recordings: [] }
    expect(rec.recordings).toEqual([])
  })

  it('replaces the rules and tells main, so the app saves them', async () => {
    const mine: RulesFile = {
      ...defaultRules(),
      rules: [
        {
          id: 'only',
          name: 'Only rule',
          enabled: true,
          match: { kind: 'always', pattern: '' },
          response: { kind: 'template', text: 'from the control API' },
        },
      ],
    }
    const put = await fetch(`${url}/_mock/rules`, json(mine, 'PUT'))
    expect(put.status).toBe(200)
    expect(changes.at(-1)?.rules?.rules.map((r) => r.id)).toEqual(['only'])
    const r = await fetch(`${url}/api/generate`, json({ model: 'm', prompt: 'x', stream: false }))
    expect(((await r.json()) as { response: string }).response).toBe('from the control API')
    const broken = await fetch(`${url}/_mock/rules`, json({ rules: 'no' }, 'PUT'))
    expect(broken.status).toBe(400)
    server.setRules(defaultRules())
  })

  it('queues and clears faults, and resets', async () => {
    const add = await fetch(`${url}/_mock/fault`, json({ mode: 'hang', count: 3 }))
    expect(((await add.json()) as { pending: string[] }).pending).toEqual(['hang', 'hang', 'hang'])
    const bad = await fetch(`${url}/_mock/fault`, json({ mode: 'explode' }))
    expect(bad.status).toBe(400)
    const clear = await fetch(`${url}/_mock/fault`, { method: 'DELETE' })
    expect(((await clear.json()) as { pending: string[] }).pending).toEqual([])
    const reset = await fetch(`${url}/_mock/reset`, json({}))
    expect(((await reset.json()) as { ok: boolean }).ok).toBe(true)
    expect(server.snapshot(false).totals.requests).toBe(0)
    expect((await fetch(`${url}/_mock/nothing`)).status).toBe(404)
  })

  it('streams snapshots to an SSE client', async () => {
    const ac = new AbortController()
    const r = await fetch(`${url}/_mock/events`, { signal: ac.signal })
    expect(r.headers.get('content-type')).toBe('text/event-stream')
    const reader = r.body?.getReader()
    const first = await reader?.read()
    ac.abort()
    const text = new TextDecoder().decode(first?.value)
    expect(text.startsWith('data: ')).toBe(true)
    expect(JSON.parse(text.slice(6))).toHaveProperty('slots')
  })
})

describe('changing the model list', () => {
  it('keeps a model pulled at run time when the configured list changes', async () => {
    const { server, url } = await startServer({ pullMs: 20 })
    try {
      const ollama = new Ollama({ host: url })
      await ollama.pull({ model: 'pulled:7b', stream: false })
      server.setConfig({ ...server.config, models: ['llama3.2:3b', 'new-one:1b'] })
      const names = (await ollama.list()).models.map((m) => m.name)
      expect(names).toContain('pulled:7b')
      expect(names).toContain('new-one:1b')
      expect(names).not.toContain('qwen3:8b')
    } finally {
      await server.stop()
    }
  })
})

describe('commands for testing how an app shows a reply', () => {
  let server: MockServer
  let url: string
  let ollama: Ollama
  let openai: OpenAI
  beforeAll(async () => {
    ;({ server, url } = await startServer())
    ollama = new Ollama({ host: url })
    openai = new OpenAI({ baseURL: `${url}/v1`, apiKey: 'ollama', maxRetries: 0 })
  })
  afterAll(() => server.stop())

  it('/error <status> fails with that status, and says when to retry a 429', async () => {
    const tooMany = await fetch(
      `${url}/api/chat`,
      json({ model: 'm', messages: [{ role: 'user', content: '/error 429' }] }),
    )
    expect(tooMany.status).toBe(429)
    expect(tooMany.headers.get('retry-after')).toBe('1')
    expect(await tooMany.json()).toEqual({ error: 'mock: injected too many requests' })
    await expect(
      openai.chat.completions.create({
        model: 'm',
        messages: [{ role: 'user', content: '/error 401' }],
      }),
    ).rejects.toMatchObject({ status: 401 })
    const plain = await fetch(`${url}/api/generate`, json({ model: 'm', prompt: '/error' }))
    expect(plain.status).toBe(500)
    const outOfRange = await fetch(
      `${url}/api/generate`,
      json({ model: 'm', prompt: '/error 999' }),
    )
    expect(outOfRange.status).toBe(500)
    expect(server.monitor.recent().at(-1)).toMatchObject({ status: 500, state: 'error' })
  })

  it('/empty streams a reply with no text that still ends properly', async () => {
    const parts: string[] = []
    let done = false
    for await (const p of await ollama.chat({
      model: 'm',
      messages: [{ role: 'user', content: '/empty' }],
      stream: true,
    })) {
      parts.push(p.message.content)
      done ||= p.done
    }
    expect(parts.join('')).toBe('')
    expect(done).toBe(true)
    const r = await openai.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: '/empty' }],
    })
    expect(r.choices[0]?.message.content).toBe('')
    expect(r.choices[0]?.finish_reason).toBe('stop')
  })

  it('/long <n> gives that many words, capped', async () => {
    const r = await ollama.generate({ model: 'm', prompt: '/long 300' })
    expect(r.response.trim().split(/\s+/)).toHaveLength(300)
  })

  it('/tool calls any tool with the arguments given', async () => {
    const r = await ollama.chat({
      model: 'm',
      messages: [{ role: 'user', content: '/tool search_docs {"query": "cats", "limit": 3}' }],
    })
    expect(r.message.tool_calls?.[0]?.function).toMatchObject({
      name: 'search_docs',
      arguments: { query: 'cats', limit: 3 },
    })
    const o = await openai.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: '/tool ping' }],
    })
    const call = o.choices[0]?.message.tool_calls?.[0]
    expect(call?.type === 'function' && call.function.name).toBe('ping')
    expect(call?.type === 'function' && JSON.parse(call.function.arguments)).toEqual({})
  })

  it('/markdown and /unicode come back byte for byte', async () => {
    const md = await ollama.generate({ model: 'm', prompt: '/markdown' })
    expect(md.response).toContain('| Left | Center | Right |')
    expect(md.response).toContain('```ts')
    const uni = await ollama.generate({ model: 'm', prompt: '/unicode' })
    expect(uni.response).toContain('👨‍👩‍👧‍👦')
    expect(uni.response).toContain('é')
    expect(uni.response).toContain('𠮷')
  })
})
