import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Ollama } from 'ollama'
import OpenAI from 'openai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, KEY_MASK, presetById } from '../../src/core/config.ts'
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
  it('makes every model in its list usable, with strict models on', async () => {
    const up = await startServer({ models: ['up-only:7b'], strictModels: true })
    const mixed = await startServer({
      mode: 'mixed',
      upstream: up.url,
      models: ['mock-only:1b'],
      strictModels: true,
    })
    try {
      await mixed.server.upstream.poll()
      const ollama = new Ollama({ host: mixed.url })
      // A rule answers for the real Ollama's model too.
      const echo = await ollama.generate({ model: 'up-only:7b', prompt: '/echo ruled' })
      expect(echo.response).toBe('ruled')
      // A model only the mock has is answered here even when nothing matches.
      await ollama.generate({ model: 'mock-only:1b', prompt: 'rivers and mountains' })
      expect((await lastRecord(mixed.server)).match?.source).toBe('fallback')
      expect(up.server.monitor.recent()).toHaveLength(0)
      // The rest still goes to Ollama.
      await ollama.generate({ model: 'up-only:7b', prompt: 'rivers and mountains' })
      expect((await lastRecord(mixed.server)).match?.source).toBe('upstream')
      expect(up.server.monitor.recent()).toHaveLength(1)
    } finally {
      await mixed.server.stop()
      await up.server.stop()
    }
  })
})

describe('an upstream that needs an API key', () => {
  const KEY = 'sk-test-upstream'
  /** Like a hosted OpenAI-compatible endpoint: /v1 only, and 401 without the right key. */
  let cloud: ReturnType<typeof createServer>
  let cloudUrl: string
  const seen: (string | undefined)[] = []

  beforeAll(async () => {
    cloud = createServer((req, res) => {
      // What the forwarded chats carried; the health polls run on their own timer.
      if (req.url === '/v1/chat/completions') seen.push(req.headers.authorization)
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end('{"error":{"message":"invalid api key"}}')
        return
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"object":"list","data":[{"id":"gpt-cloud"}]}')
        return
      }
      if (req.url === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'c1',
            object: 'chat.completion',
            created: 0,
            model: 'gpt-cloud',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'hi from the cloud' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 },
          }),
        )
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>((r) => cloud.listen(0, '127.0.0.1', r))
    cloudUrl = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}/v1`
  })
  afterAll(() => {
    cloud.close()
  })

  const chat = (base: string, auth?: string) =>
    fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ model: 'gpt-cloud', messages: [{ role: 'user', content: 'hi' }] }),
    })

  it('is reported down without the key, and live through /v1 with it', async () => {
    const without = await startServer({ mode: 'proxy', upstream: cloudUrl })
    const withKey = await startServer({ mode: 'proxy', upstream: cloudUrl, upstreamKey: KEY })
    try {
      await without.server.upstream.poll()
      await withKey.server.upstream.poll()
      expect(without.server.snapshot(false).upstream).toMatchObject({ ok: false })
      expect(without.server.snapshot(false).upstream?.error).toContain('401')
      expect(withKey.server.snapshot(false).upstream).toMatchObject({
        ok: true,
        api: 'openai',
        models: ['gpt-cloud'],
      })
    } finally {
      await without.server.stop()
      await withKey.server.stop()
    }
  })

  it("sends the key in place of the client's placeholder, and keeps it out of the record", async () => {
    const { server, url } = await startServer({
      mode: 'proxy',
      upstream: cloudUrl,
      upstreamKey: KEY,
    })
    try {
      seen.length = 0
      // The OpenAI client sends a key of its own; aimed at Ollama, it is a placeholder.
      const r = await chat(url, 'Bearer ollama')
      expect(r.status).toBe(200)
      expect(
        ((await r.json()) as { choices: { message: { content: string } }[] }).choices[0]?.message
          .content,
      ).toBe('hi from the cloud')
      expect(seen.at(-1)).toBe(`Bearer ${KEY}`)
      expect(JSON.stringify(await lastRecord(server))).not.toContain(KEY)
    } finally {
      await server.stop()
    }
  })

  it("passes the client's own Authorization on when no key is set", async () => {
    const { server, url } = await startServer({ mode: 'proxy', upstream: cloudUrl })
    try {
      seen.length = 0
      expect((await chat(url, `Bearer ${KEY}`)).status).toBe(200)
      expect((await chat(url)).status).toBe(401)
      expect(seen.slice(-2)).toEqual([`Bearer ${KEY}`, undefined])
    } finally {
      await server.stop()
    }
  })

  it('shows the control API a mask, and keeps the key when the mask comes back', async () => {
    const { server, url } = await startServer({
      mode: 'proxy',
      upstream: cloudUrl,
      upstreamKey: KEY,
    })
    try {
      const shown = (await (await fetch(`${url}/_mock/config`)).json()) as Record<string, unknown>
      expect(shown.upstreamKey).toBe(KEY_MASK)
      expect(JSON.stringify(shown)).not.toContain(KEY)
      // A client that reads the config, changes one field and sends it all back.
      const r = await fetch(`${url}/_mock/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...shown, ttftMs: 1 }),
      })
      expect(JSON.stringify(await r.json())).not.toContain(KEY)
      seen.length = 0
      expect((await chat(url, 'Bearer ollama')).status).toBe(200)
      expect(seen.at(-1)).toBe(`Bearer ${KEY}`)
    } finally {
      await server.stop()
    }
  })
})

describe('an OpenAI base that does not end in /v1, and the model map', () => {
  /** Like Gemini's OpenAI-compatible endpoint: everything under /v1beta/openai. */
  let gem: ReturnType<typeof createServer>
  let base: string
  const got: { path: string; body: string }[] = []

  beforeAll(async () => {
    gem = createServer((req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => {
        body += c.toString()
      })
      req.on('end', () => {
        if (req.url === '/v1beta/openai/models') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end('{"object":"list","data":[{"id":"gemini-x"}]}')
          return
        }
        if (req.url === '/v1beta/openai/chat/completions') {
          got.push({ path: req.url, body })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'g1',
              object: 'chat.completion',
              created: 0,
              model: 'gemini-x',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'from gemini' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
            }),
          )
          return
        }
        res.writeHead(404).end()
      })
    })
    await new Promise<void>((r) => gem.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(gem.address() as AddressInfo).port}/v1beta/openai`
  })
  afterAll(() => {
    gem.close()
  })

  it('sends the client /v1/... under that base and finds the models there', async () => {
    const { server, url } = await startServer({ mode: 'proxy', upstream: base })
    try {
      await server.upstream.poll()
      expect(server.snapshot(false).upstream).toMatchObject({
        ok: true,
        api: 'openai',
        models: ['gemini-x'],
      })
      const openai = new OpenAI({ baseURL: `${url}/v1`, apiKey: 'x' })
      const r = await openai.chat.completions.create({
        model: 'gemini-x',
        messages: [{ role: 'user', content: 'hi' }],
      })
      expect(r.choices[0]?.message.content).toBe('from gemini')
      expect(got.at(-1)?.path).toBe('/v1beta/openai/chat/completions')
    } finally {
      await server.stop()
    }
  })

  it("sends the mapped model upstream, and keeps the app's name everywhere else", async () => {
    const { server, url } = await startServer({
      mode: 'proxy',
      upstream: base,
      modelMap: ['llama3.2:3b=gemini-x'],
    })
    try {
      const r = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'llama3.2:3b', messages: [{ role: 'user', content: 'hi' }] }),
      })
      // The reply is the upstream's own, model name included.
      const reply = (await r.json()) as { model: string }
      expect(reply.model).toBe('gemini-x')
      expect(JSON.parse(got.at(-1)?.body ?? '{}')).toMatchObject({
        model: 'gemini-x',
        messages: [{ role: 'user', content: 'hi' }],
      })
      const rec = await lastRecord(server)
      expect(rec.model).toBe('llama3.2:3b')
      expect(rec.match).toMatchObject({ source: 'upstream', model: 'gemini-x' })
      expect(rec.requestBody).toMatchObject({ model: 'llama3.2:3b' })
    } finally {
      await server.stop()
    }
  })

  it('forwards the exact bytes of a request the map does not touch', async () => {
    const { server, url } = await startServer({
      mode: 'proxy',
      upstream: base,
      modelMap: ['other=gemini-x'],
    })
    try {
      // Spacing and key order a re-serialised body would lose.
      const body = '{ "messages" : [ {"role":"user","content":"hi"} ], "model":"gemini-x" }'
      await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
      expect(got.at(-1)?.body).toBe(body)
      expect((await lastRecord(server)).match?.model).toBeUndefined()
    } finally {
      await server.stop()
    }
  })
})

describe('proxy fixes from the v0.0.5 review', () => {
  let upstream: MockServer
  let upUrl: string
  /** Ollama behind a path prefix, as a reverse proxy would put it. */
  let gateway: ReturnType<typeof createServer>
  let gwUrl: string
  const seenPaths: string[] = []
  const shown: string[] = []

  beforeAll(async () => {
    const u = await startServer()
    upstream = u.server
    upUrl = u.url
    gateway = createServer((req, res) => {
      const path = (req.url ?? '').replace(/^\/ollama/, '')
      seenPaths.push(path)
      let body = ''
      req.on('data', (c: Buffer) => {
        body += c.toString()
      })
      req.on('end', () => {
        if (path === '/api/show') shown.push(body)
        void fetch(`${upUrl}${path}`, {
          method: req.method ?? 'GET',
          headers: { 'content-type': 'application/json' },
          body: req.method === 'GET' || req.method === 'HEAD' ? null : body,
        }).then(async (r) => {
          res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? '' })
          res.end(Buffer.from(await r.arrayBuffer()))
        })
      })
    })
    await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r))
    gwUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/ollama`
  })
  afterAll(async () => {
    gateway.close()
    await upstream.stop()
  })

  it('keeps /v1 for an Ollama behind a path prefix given without /v1, as v0.0.4 did', async () => {
    const { server, url } = await startServer({ mode: 'proxy', upstream: gwUrl })
    try {
      await server.upstream.poll()
      expect(server.snapshot(false).upstream).toMatchObject({ ok: true, api: 'ollama' })
      const openai = new OpenAI({ baseURL: `${url}/v1`, apiKey: 'x' })
      const r = await openai.chat.completions.create({
        model: 'llama3.2:3b',
        messages: [{ role: 'user', content: 'hello' }],
      })
      expect(r.choices[0]?.message.content).toBeTruthy()
      expect(seenPaths).toContain('/v1/chat/completions')
    } finally {
      await server.stop()
    }
  })

  it('asks /api/show about the mapped model, and leaves other pass-through requests alone', async () => {
    const { server, url } = await startServer({
      mode: 'proxy',
      upstream: `${upUrl}/v1`,
      modelMap: ['my-app-model=llama3.2:3b'],
    })
    const relay = await startServer({ mode: 'proxy', upstream: `${gwUrl}/v1`, modelMap: ['a=b'] })
    try {
      const show = await new Ollama({ host: url }).show({ model: 'my-app-model' })
      expect(show.details).toBeTruthy()
      // Through the gateway, which records what reached it: a model the map does not name
      // passes unchanged.
      await fetch(`${relay.url}/api/show`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"model":"llama3.2:3b"}',
      })
      expect(shown.at(-1)).toBe('{"model":"llama3.2:3b"}')
    } finally {
      await server.stop()
      await relay.server.stop()
    }
  })

  it('answers a mock-only model in mixed mode when only a "*" pair would rename it', async () => {
    const { server, url } = await startServer({
      mode: 'mixed',
      upstream: `${upUrl}/v1`,
      models: ['mock-only:1b', 'llama3.2:3b'],
      modelMap: ['*=llama3.2:3b'],
    })
    try {
      await server.upstream.poll()
      await new Ollama({ host: url }).generate({
        model: 'mock-only:1b',
        prompt: 'zzqx unknown words',
      })
      expect((await lastRecord(server)).match?.source).not.toBe('upstream')
    } finally {
      await server.stop()
    }
  })

  it('polls an OpenAI-only upstream for its models alone, and not on every tick', async () => {
    let hits = 0
    const only = createServer((req, res) => {
      hits++
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"data":[{"id":"m"}]}')
        return
      }
      res.writeHead(404).end()
    })
    await new Promise<void>((r) => only.listen(0, '127.0.0.1', r))
    const { server } = await startServer({
      mode: 'proxy',
      upstream: `http://127.0.0.1:${(only.address() as AddressInfo).port}/v1`,
    })
    try {
      await server.upstream.poll()
      expect(server.snapshot(false).upstream).toMatchObject({ ok: true, api: 'openai' })
      hits = 0
      await server.upstream.poll()
      expect(hits).toBe(1)
      await server.upstream.pollSoon()
      expect(hits).toBe(1)
    } finally {
      await server.stop()
      only.close()
    }
  })
})
