import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'
import { LoadGenerator, Playground } from '../../src/main/client.ts'
import type { LoadGenStatus, PlaygroundEvent, PlaygroundRequest } from '../../src/shared/api.ts'

/** The playground and load generator main runs for the UI, against a real mock server. */
let server: MockServer
let url: string
beforeAll(async () => {
  const instant = presetById('instant')
  if (!instant) throw new Error('no instant preset')
  server = new MockServer({
    config: { ...applyPreset(defaultConfig(), instant), port: 0, seed: 2 },
    rules: defaultRules(),
  })
  url = await server.start()
})
afterAll(() => server.stop())

function send(req: Partial<PlaygroundRequest>): Promise<PlaygroundEvent[]> {
  const pg = new Playground()
  const events: PlaygroundEvent[] = []
  return new Promise((resolve) => {
    pg.send(
      url,
      {
        api: 'chat',
        model: 'llama3.2:3b',
        prompt: '/echo hello playground',
        system: '',
        stream: true,
        think: false,
        json: false,
        ...req,
      },
      (e) => {
        events.push(e)
        if (e.type === 'done' || e.type === 'error') resolve(events)
      },
    )
  })
}
const text = (events: PlaygroundEvent[]) =>
  events.map((e) => (e.type === 'chunk' ? e.content : '')).join('')

describe('the playground', () => {
  for (const api of ['chat', 'generate', 'openai'] as const)
    for (const stream of [true, false])
      it(`reads the reply of ${api} (stream: ${stream})`, async () => {
        const events = await send({ api, stream })
        expect(events[0]).toMatchObject({ type: 'request', method: 'POST' })
        expect(events.find((e) => e.type === 'status')).toMatchObject({ status: 200 })
        expect(text(events)).toBe('hello playground')
        expect(events.at(-1)?.type).toBe('done')
      })

  it('shows tool calls and thinking', async () => {
    const tool = await send({ prompt: '東京の天気は？' })
    expect(text(tool)).toContain('[tool_calls]')
    expect(text(tool)).toContain('get_weather')
    const think = await send({ prompt: 'why is the sky blue', think: true })
    const thinking = think.map((e) => (e.type === 'chunk' ? e.thinking : '')).join('')
    expect(thinking.length).toBeGreaterThan(0)
  })

  it('reports an HTTP error and a cancel', async () => {
    server.injectFault('error500')
    const failed = await send({})
    expect(failed.find((e) => e.type === 'status')).toMatchObject({ status: 500 })

    const pg = new Playground()
    server.injectFault('hang')
    const events: PlaygroundEvent[] = []
    const done = new Promise<void>((resolve) => {
      const id = pg.send(
        url,
        {
          api: 'chat',
          model: 'm',
          prompt: 'x',
          system: '',
          stream: true,
          think: false,
          json: false,
        },
        (e) => {
          events.push(e)
          if (e.type === 'error' || e.type === 'done') resolve()
        },
      )
      setTimeout(() => pg.cancel(id), 200)
    })
    await done
    expect(events.at(-1)).toMatchObject({ type: 'error', message: 'cancelled' })
  })
})

describe('the load generator', () => {
  it('sends the total it was asked for, at the concurrency it was given', async () => {
    const gen = new LoadGenerator()
    const seen: LoadGenStatus[] = []
    server.monitor.reset()
    await gen.run(
      url,
      server.listModels(),
      { concurrency: 4, total: 12, api: 'chat', randomModels: true },
      (s) => seen.push(s),
    )
    expect(gen.status).toMatchObject({ running: false, sent: 12, ok: 12, failed: 0 })
    expect(seen.at(-1)?.running).toBe(false)
    expect(server.snapshot(false).totals.requests).toBe(12)
  })
})
