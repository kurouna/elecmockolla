import { Ollama } from 'ollama'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import { toHar, toJsonExport } from '../../src/core/export.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'
import type { RequestRecord } from '../../src/shared/types.ts'

describe('request history export', () => {
  let server: MockServer
  let url: string
  let records: RequestRecord[]

  beforeAll(async () => {
    const instant = presetById('instant')
    if (!instant) throw new Error('no instant preset')
    server = new MockServer({
      config: { ...applyPreset(defaultConfig(), instant), port: 0, seed: 1 },
      rules: defaultRules(),
      appVersion: '9.9.9',
    })
    url = await server.start()
    const ollama = new Ollama({ host: url })
    await ollama.chat({
      model: 'qwen3:8b',
      messages: [{ role: 'user', content: 'hello' }],
      think: true,
    })
    server.injectFault('error500')
    await ollama.generate({ model: 'm', prompt: 'x' }).catch(() => {})
    records = server.monitor.recent()
  })
  afterAll(() => server.stop())

  it('writes HAR 1.2 that tools can read', () => {
    const har = JSON.parse(toHar(records, { url, version: '9.9.9', mode: 'mock' }))
    expect(har.log).toMatchObject({
      version: '1.2',
      creator: { name: 'elecmockolla', version: '9.9.9' },
    })
    expect(har.log.entries).toHaveLength(2)
    const [chat, failed] = har.log.entries
    expect(chat.request).toMatchObject({ method: 'POST', url: `${url}/api/chat` })
    expect(JSON.parse(chat.request.postData.text)).toMatchObject({ model: 'qwen3:8b' })
    expect(chat.response.status).toBe(200)
    expect(chat.response.content.text).toContain('hello!')
    expect(Date.parse(chat.startedDateTime)).toBeGreaterThan(0)
    for (const e of har.log.entries) {
      expect(e.time).toBeGreaterThanOrEqual(0)
      for (const v of Object.values(e.timings) as number[]) expect(v).toBeGreaterThanOrEqual(-1)
    }
    expect(chat._elecmockolla).toMatchObject({ api: 'chat', match: { source: 'rule' } })
    expect(failed.response.status).toBe(500)
    expect(failed._elecmockolla.fault).toBe('error500')
  })

  it('writes every recorded field in the JSON export', () => {
    const doc = JSON.parse(toJsonExport(records, { url, version: '9.9.9', mode: 'mock' }))
    expect(doc).toMatchObject({ app: 'elecmockolla', version: '9.9.9', server: url, mode: 'mock' })
    expect(doc.requests).toEqual(JSON.parse(JSON.stringify(records)))
  })

  it('keeps CORS off the control API, and on the Ollama API', async () => {
    const control = await fetch(`${url}/_mock/config`, {
      headers: { Origin: 'https://example.com' },
    })
    expect(control.headers.get('access-control-allow-origin')).toBeNull()
    const ollama = await fetch(`${url}/api/tags`, { headers: { Origin: 'https://example.com' } })
    expect(ollama.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('serves both from the control API', async () => {
    const har = (await (await fetch(`${url}/_mock/requests?format=har`)).json()) as {
      log: { entries: unknown[]; creator: { version: string } }
    }
    expect(har.log.entries).toHaveLength(2)
    expect(har.log.creator.version).toBe('9.9.9')
    const json = (await (await fetch(`${url}/_mock/requests?format=json`)).json()) as {
      requests: unknown[]
    }
    expect(json.requests).toHaveLength(2)
    expect((await fetch(`${url}/_mock/requests?format=csv`)).status).toBe(400)
  })
})
