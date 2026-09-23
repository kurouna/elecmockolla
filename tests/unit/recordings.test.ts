import { Ollama } from 'ollama'
import OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import {
  matchText,
  normalizeRecordings,
  parseRecordings,
  RecordingStore,
  recordingsToJson,
} from '../../src/core/recordings.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'
import type { MockConfig, Recording } from '../../src/shared/types.ts'

async function startServer(patch: Partial<MockConfig> = {}, recordings: Recording[] = []) {
  const instant = presetById('instant')
  if (!instant) throw new Error('no instant preset')
  const config = { ...applyPreset(defaultConfig(), instant), port: 0, seed: 3, ...patch }
  const server = new MockServer({ config, rules: defaultRules(), recordings })
  const url = await server.start()
  return { server, url }
}

/** A mock standing in for Ollama, and a proxy in front of it that records. */
async function recordSome(prompts: string[], model = 'llama3.2:3b') {
  const up = await startServer()
  const proxy = await startServer({ mode: 'proxy', upstream: up.url, record: true })
  const saved: Recording[] = []
  proxy.server.onRecorded = (r) => saved.push(r)
  const replies: string[] = []
  try {
    for (const p of prompts) {
      let text = ''
      const s = await new Ollama({ host: proxy.url }).chat({
        model,
        messages: [{ role: 'user', content: p }],
        stream: true,
      })
      for await (const part of s) text += part.message.content
      replies.push(text)
    }
  } finally {
    await proxy.server.stop()
    await up.server.stop()
  }
  return { saved, replies }
}

describe('matching', () => {
  it('ignores case, width, spaces, punctuation and symbols', () => {
    expect(matchText('Hello, World!')).toBe(matchText('hello world'))
    expect(matchText('東京の天気は？')).toBe(matchText('東京の 天気は'))
    expect(matchText('ＡＢＣ　１２３')).toBe('abc123')
    expect(matchText('？')).toBe('？')
    const store = new RecordingStore()
    const r = normalizeRecordings([{ model: 'm', conversation: 'Hi there!', chunks: ['yo'] }])[0]
    if (!r) throw new Error('no recording')
    expect(store.add(r)).toBe(true)
    expect(store.add({ ...r, id: 'other' })).toBe(false)
    expect(store.find('m:latest', 'hi   there')).toBe(r)
    expect(store.find('other', 'hi there')).toBeUndefined()
  })

  it('round-trips the file and rejects bad entries', () => {
    const list = normalizeRecordings({
      recordings: [{ model: 'a:1b', conversation: 'x', chunks: ['1', '2'], tps: 12 }],
    })
    expect(parseRecordings(recordingsToJson(list))).toEqual(list)
    expect(() => normalizeRecordings({ recordings: [{ model: 'a' }] })).toThrow(/conversation/)
    expect(() => parseRecordings('nope')).toThrow(/JSON/)
  })
})

describe('recording and playback', () => {
  it('records what Ollama streamed, once per input', async () => {
    const { saved, replies } = await recordSome([
      'tell me about rivers',
      'Tell me about rivers!!',
      'hello',
    ])
    expect(saved).toHaveLength(2)
    const [first] = saved
    expect(first).toMatchObject({
      model: 'llama3.2:3b',
      api: 'chat',
      prompt: 'tell me about rivers',
    })
    expect(first?.chunks.join('')).toBe(replies[0])
    expect(first?.chunks.length).toBeGreaterThan(3)
  })

  it('plays a recording back chunk for chunk when playback is on', async () => {
    const { saved, replies } = await recordSome(['tell me about rivers'])
    const on = await startServer({ replay: true }, saved)
    const off = await startServer({ replay: false }, saved)
    try {
      const ask = async (host: string, content: string) => {
        const parts: string[] = []
        const s = await new Ollama({ host }).chat({
          model: 'llama3.2:3b',
          messages: [{ role: 'user', content }],
          stream: true,
        })
        for await (const part of s) if (part.message.content) parts.push(part.message.content)
        return parts
      }
      const played = await ask(on.url, 'Tell me, about rivers.')
      expect(played).toEqual(saved[0]?.chunks)
      expect(played.join('')).toBe(replies[0])
      expect(on.server.monitor.recent().at(-1)?.match?.source).toBe('recording')

      await ask(off.url, 'tell me about rivers')
      expect(off.server.monitor.recent().at(-1)?.match?.source).toBe('fallback')

      // The same recording answers through the OpenAI API too.
      const openai = new OpenAI({ baseURL: `${on.url}/v1`, apiKey: 'x' })
      const r = await openai.chat.completions.create({
        model: 'llama3.2:3b',
        messages: [{ role: 'user', content: 'tell me about rivers' }],
      })
      expect(r.choices[0]?.message.content).toBe(replies[0])
    } finally {
      await on.server.stop()
      await off.server.stop()
    }
  })

  it('returns recorded text verbatim, placeholders included', async () => {
    const rec = normalizeRecordings([
      { model: 'm', conversation: 'q', chunks: ['cost: $1 ', '{{model}}'] },
    ])
    const { server, url } = await startServer({ replay: true }, rec)
    try {
      const r = await new Ollama({ host: url }).generate({ model: 'm', prompt: 'Q?' })
      expect(r.response).toBe('cost: $1 {{model}}')
    } finally {
      await server.stop()
    }
  })

  it('answers recorded prompts itself in mixed mode', async () => {
    const up = await startServer()
    const rec = normalizeRecordings([{ model: 'm', conversation: 'cached', chunks: ['from tape'] }])
    const mixed = await startServer({ mode: 'mixed', upstream: up.url, replay: true }, rec)
    try {
      const r = await new Ollama({ host: mixed.url }).generate({ model: 'm', prompt: 'Cached.' })
      expect(r.response).toBe('from tape')
      expect(up.server.monitor.recent()).toHaveLength(0)
    } finally {
      await mixed.server.stop()
      await up.server.stop()
    }
  })
})
