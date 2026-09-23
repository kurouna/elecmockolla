import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Ollama } from 'ollama'
import OpenAI from 'openai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'
import type { MockConfig, RequestRecord } from '../../src/shared/types.ts'

// A mock server stands in for the real Ollama; a second one proxies to it.
async function startServer(patch: Partial<MockConfig> = {}) {
  const instant = presetById('instant')
  if (!instant) throw new Error('no instant preset')
  const config = { ...applyPreset(defaultConfig(), instant), port: 0, seed: 7, ...patch }
  const server = new MockServer({ config, rules: defaultRules() })
  const url = await server.start()
  return { server, url }
}

/** The newest finished record, waiting briefly for the server to file it. */
async function lastRecord(server: MockServer): Promise<RequestRecord> {
  for (let i = 0; i < 50; i++) {
    const r = server.monitor.recent().at(-1)
    if (r && server.monitor.active.size === 0) return r
    await new Promise((res) => setTimeout(res, 10))
  }
  throw new Error('no record')
}

describe('proxy mode', () => {
  let upstream: MockServer
  let proxy: MockServer
  let upUrl: string
  let url: string

  beforeAll(async () => {
    const u = await startServer()
    upstream = u.server
    upUrl = u.url
    const p = await startServer({ mode: 'proxy', upstream: upUrl })
    proxy = p.server
    url = p.url
  })
  afterAll(async () => {
    await proxy.stop()
    await upstream.stop()
  })

  it('passes a streamed chat through unchanged and records it', async () => {
    const ask = (host: string) =>
      new Ollama({ host }).chat({
        model: 'llama3.2:3b',
        messages: [{ role: 'user', content: 'tell me about rivers' }],
        stream: true,
      })
    let direct = ''
    for await (const part of await ask(upUrl)) direct += part.message.content
    let proxied = ''
    let evalCount = 0
    for await (const part of await ask(url)) {
      proxied += part.message.content
      if (part.done) evalCount = part.eval_count
    }
    expect(proxied).toBe(direct)
    const rec = await lastRecord(proxy)
    expect(rec).toMatchObject({ api: 'chat', state: 'done', status: 200, model: 'llama3.2:3b' })
    expect(rec.match?.source).toBe('upstream')
    expect(rec.responseText).toBe(direct)
    expect(rec.tokens).toBe(evalCount)
    expect(rec.reported?.evalTokens).toBe(evalCount)
    expect(rec.t.firstToken).toBeGreaterThan(0)
  })

  it('records non-streamed, OpenAI and embedding replies', async () => {
    const g = await new Ollama({ host: url }).generate({ model: 'qwen3:8b', prompt: 'これは何？' })
    expect(g.response.startsWith('いい質問ですね。')).toBe(true)
    expect((await lastRecord(proxy)).responseText).toBe(g.response)

    const openai = new OpenAI({ baseURL: `${url}/v1`, apiKey: 'x' })
    const stream = await openai.chat.completions.create({
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })
    let text = ''
    for await (const c of stream) text += c.choices[0]?.delta.content ?? ''
    const rec = await lastRecord(proxy)
    expect(rec).toMatchObject({ api: 'openai-chat', state: 'done' })
    expect(rec.responseText).toBe(text)

    const e = await new Ollama({ host: url }).embed({
      model: 'nomic-embed-text',
      input: ['a', 'b'],
    })
    expect(e.embeddings).toHaveLength(2)
    expect((await lastRecord(proxy)).responseText).toBe('2 vector(s)')
  })

  it('passes other endpoints through and reports the upstream', async () => {
    const tags = await new Ollama({ host: url }).list()
    expect(tags.models.map((m) => m.name)).toContain('gpt-oss:20b')
    await proxy.upstream.poll()
    const snap = proxy.snapshot(false)
    expect(snap.upstream).toMatchObject({ ok: true, api: 'ollama', version: '0.12.0' })
    expect(snap.models).toContain('qwen3:8b')
  })

  it('takes the upstream as OpenAI clients do, ending in /v1', async () => {
    const { server, url: v1proxy } = await startServer({ mode: 'proxy', upstream: `${upUrl}/v1` })
    try {
      await server.upstream.poll()
      expect(server.snapshot(false).upstream).toMatchObject({ ok: true, version: '0.12.0' })
      const tags = await new Ollama({ host: v1proxy }).list()
      expect(tags.models.length).toBeGreaterThan(0)
      const openai = new OpenAI({ baseURL: `${v1proxy}/v1`, apiKey: 'x' })
      const r = await openai.chat.completions.create({
        model: 'llama3.2:3b',
        messages: [{ role: 'user', content: 'hello' }],
      })
      expect(r.choices[0]?.message.content).toBeTruthy()
      const g = await new Ollama({ host: v1proxy }).generate({ model: 'm', prompt: 'hello' })
      expect(g.response).toBeTruthy()
    } finally {
      await server.stop()
    }
  })

  /** The stand-in Ollama behind a server that answers 404 for the paths `blocked` picks. */
  async function watchThrough(blocked: (path: string) => boolean) {
    const partial = createServer((req, res) => {
      if (blocked(req.url ?? '')) {
        res.writeHead(404).end('404 page not found')
        return
      }
      void fetch(new URL(`${upUrl}${req.url}`), { method: req.method ?? 'GET' }).then(async (r) => {
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? '' })
        res.end(Buffer.from(await r.arrayBuffer()))
      })
    })
    await new Promise<void>((r) => partial.listen(0, '127.0.0.1', r))
    const port = (partial.address() as AddressInfo).port
    const { server } = await startServer({ mode: 'proxy', upstream: `http://127.0.0.1:${port}/v1` })
    await server.upstream.poll()
    const close = async () => {
      await server.stop()
      partial.close()
    }
    return { server, info: server.snapshot(false).upstream, close }
  }

  it('connects to a server that has only the OpenAI-compatible /v1', async () => {
    // Like LM Studio, llama.cpp or a proxy exposing only /v1.
    const { server, info, close } = await watchThrough((p) => p.startsWith('/api/'))
    try {
      expect(info).toMatchObject({ ok: true, api: 'openai', version: '', loaded: null })
      expect(info?.models).toContain('llama3.2:3b')
      // Which models are loaded is unknown, so a request is never shown as loading one.
      expect(server.upstream.isCold('llama3.2:3b')).toBe(false)
    } finally {
      await close()
    }
  })

  it('tells "no loaded models" from "cannot see them" when /api/ps fails', async () => {
    const { server, info, close } = await watchThrough((p) => p === '/api/ps')
    try {
      expect(info).toMatchObject({ ok: true, api: 'ollama', version: '0.12.0', loaded: null })
      expect(server.upstream.isCold('llama3.2:3b')).toBe(false)
    } finally {
      await close()
    }
    // With /api/ps answering, a model it does not list is cold.
    await proxy.upstream.poll()
    expect(proxy.snapshot(false).upstream?.loaded).toEqual(expect.any(Array))
    expect(proxy.upstream.isCold('never-used:1b')).toBe(true)
  })

  it('neither finishes nor records a reply the upstream breaks off', async () => {
    const cut = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(
        `${JSON.stringify({ message: { role: 'assistant', content: 'Hello wor' }, done: false })}\n`,
      )
      setTimeout(() => res.destroy(), 30)
    })
    await new Promise<void>((r) => cut.listen(0, '127.0.0.1', r))
    const port = (cut.address() as AddressInfo).port
    const { server, url: p } = await startServer({
      mode: 'proxy',
      upstream: `http://127.0.0.1:${port}/v1`,
      record: true,
    })
    const saved: unknown[] = []
    server.onRecorded = (r) => saved.push(r)
    try {
      await fetch(`${p}/api/chat`, {
        method: 'POST',
        body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
      })
        .then((r) => r.text())
        .catch(() => '')
      const rec = await lastRecord(server)
      expect(rec).toMatchObject({ state: 'error', status: 502 })
      expect(saved).toEqual([])
    } finally {
      await server.stop()
      cut.close()
    }
  })

  it('injects faults into real replies', async () => {
    proxy.injectFault('disconnect')
    await expect(
      (async () => {
        const s = await new Ollama({ host: url }).generate({
          model: 'm',
          prompt: 'tell me a long story',
          stream: true,
          options: { num_predict: 100 },
        })
        for await (const _ of s) {
          // drain
        }
      })(),
    ).rejects.toThrow()
    const rec = await lastRecord(proxy)
    expect(rec).toMatchObject({ state: 'error', fault: 'disconnect' })
    expect(rec.tokens).toBeGreaterThan(0)

    proxy.injectFault('error500')
    const r = await fetch(`${url}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({ model: 'm', prompt: 'x' }),
    })
    expect(r.status).toBe(500)
  })

  it('reports an unreachable upstream and a proxy loop', async () => {
    const { server, url: self } = await startServer({
      mode: 'proxy',
      upstream: 'http://127.0.0.1:9',
    })
    try {
      const r = await fetch(`${self}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: 'm', prompt: 'x' }),
      })
      expect(r.status).toBe(502)
      expect((await lastRecord(server)).status).toBe(502)

      server.setConfig({ ...server.config, upstream: self })
      const loop = await fetch(`${self}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({ model: 'm', prompt: 'x' }),
      })
      expect(loop.status).toBe(508)
    } finally {
      await server.stop()
    }
  })
})

describe('mixed mode', () => {
  it('answers rule matches itself and sends the rest to Ollama', async () => {
    const up = await startServer()
    const mixed = await startServer({ mode: 'mixed', upstream: up.url })
    try {
      const ollama = new Ollama({ host: mixed.url })
      const echo = await ollama.generate({ model: 'm', prompt: '/echo straight from the rules' })
      expect(echo.response).toBe('straight from the rules')
      expect((await lastRecord(mixed.server)).match?.source).toBe('rule')
      expect(up.server.monitor.recent()).toHaveLength(0)

      await ollama.generate({ model: 'm', prompt: 'rivers and mountains' })
      expect((await lastRecord(mixed.server)).match?.source).toBe('upstream')
      expect(up.server.monitor.recent()).toHaveLength(1)
    } finally {
      await mixed.server.stop()
      await up.server.stop()
    }
  })
})
