import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyEnv,
  defaultConfig,
  KEY_MASK,
  mapModel,
  maskKey,
  openaiBase,
  parseEnv,
  parseModelMap,
  patchConfig,
  serializeEnv,
  upstreamRoot,
  upstreamUrl,
} from '../../src/core/config.ts'
import { loadConfig } from '../../src/core/files.ts'
import { embed, parseKeepAlive } from '../../src/core/models.ts'
import { Scheduler } from '../../src/core/scheduler.ts'

describe('.env', () => {
  it('parses dotenv syntax', () => {
    const env = parseEnv('# c\nA=1\nexport B="two words"\nC=x # trailing\nD=\'q\'\nbad line\n')
    expect(env).toEqual({ A: '1', B: 'two words', C: 'x', D: 'q' })
  })

  it('round-trips a config and keeps unknown keys', () => {
    const c = { ...defaultConfig(), port: 12345, seed: 7, models: ['a:1b', 'b:2b'], cors: '' }
    const text = serializeEnv(c, 'MY_OWN=keep\nMOCKOLLA_PORT=1\n')
    expect(applyEnv(defaultConfig(), parseEnv(text))).toEqual(c)
    expect(text).toContain('MY_OWN=keep')
    expect(text.match(/MOCKOLLA_PORT=/g)).toHaveLength(1)
  })

  it('clamps and ignores bad values', () => {
    const c = applyEnv(defaultConfig(), {
      MOCKOLLA_PORT: 'abc',
      MOCKOLLA_JITTER: '5',
      MOCKOLLA_NUM_PARALLEL: '0',
      MOCKOLLA_FAULT_MODE: 'nope',
    })
    expect(c.port).toBe(11434)
    expect(c.jitter).toBe(1)
    expect(c.numParallel).toBe(1)
    expect(c.faultMode).toBe('random')
  })

  it('accepts OLLAMA_* names in the file but ignores them in the environment', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mockolla-'))
    const file = path.join(dir, '.env')
    writeFileSync(file, 'OLLAMA_HOST=0.0.0.0:11500\nOLLAMA_NUM_PARALLEL=8\n')
    const { config, rulesPath } = loadConfig(file, { OLLAMA_HOST: '1.2.3.4:1', MOCKOLLA_TPS: '99' })
    expect(config).toMatchObject({ host: '0.0.0.0', port: 11500, numParallel: 8, tps: 99 })
    expect(rulesPath).toBe(path.join(dir, 'rules.json'))
  })

  it('round-trips Windows paths and other escapes through .env', () => {
    const c = {
      ...defaultConfig(),
      rulesPath: 'C:\\My Docs\\notes\\rules.json',
      recordingsPath: 'D:\\tapes\\"quoted"\\n.json',
    }
    const back = applyEnv(defaultConfig(), parseEnv(serializeEnv(c)))
    expect(back.rulesPath).toBe(c.rulesPath)
    expect(back.recordingsPath).toBe(c.recordingsPath)
    // Written by hand, not as JSON: the backslashes stay as they are.
    expect(parseEnv('A="C:\\path\\new"').A).toBe('C:\\path\\new')
  })

  it('finds the server behind an upstream URL', () => {
    expect(upstreamRoot('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434')
    expect(upstreamRoot('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434')
    expect(upstreamRoot('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434')
    expect(upstreamRoot('https://gpu/ollama/v1')).toBe('https://gpu/ollama')
    expect(defaultConfig().upstream).toBe('http://127.0.0.1:11434/v1')
  })

  it('patches from UI values', () => {
    const c = patchConfig(defaultConfig(), { tps: 12.5, seed: null, models: ['m:1b'] })
    expect(c).toMatchObject({ tps: 12.5, seed: null, models: ['m:1b'] })
  })
})

describe('keep_alive', () => {
  it('parses durations', () => {
    expect(parseKeepAlive('5m', 1)).toBe(300)
    expect(parseKeepAlive('1h30m', 1)).toBe(5400)
    expect(parseKeepAlive(0, 1)).toBe(0)
    expect(parseKeepAlive(-1, 1)).toBe(Number.POSITIVE_INFINITY)
    expect(parseKeepAlive('-1m', 1)).toBe(Number.POSITIVE_INFINITY)
    expect(parseKeepAlive(undefined, 42)).toBe(42)
  })
})

describe('embeddings', () => {
  const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0)
  it('are normalised, deterministic and similar for similar texts', () => {
    const a = embed('the cat sat on the mat', 256, 'm')
    expect(embed('the cat sat on the mat', 256, 'm')).toEqual(a)
    expect(cos(a, a)).toBeCloseTo(1, 3)
    const near = embed('a cat sat on a mat', 256, 'm')
    const far = embed('quantum chromodynamics lecture', 256, 'm')
    expect(cos(a, near)).toBeGreaterThan(cos(a, far) + 0.3)
  })
})

describe('Scheduler', () => {
  it('queues beyond capacity and rejects beyond the queue', async () => {
    const s = new Scheduler(2, 1)
    const a = await s.acquire(1)
    const b = await s.acquire(2)
    expect([a, b]).toEqual([0, 1])
    const waiting = s.acquire(3)
    await expect(s.acquire(4)).rejects.toThrow(/maximum pending/)
    expect(s.queue()).toEqual([3])
    s.release(a)
    await expect(waiting).resolves.toBe(0)
  })

  it('drops an aborted waiter', async () => {
    const s = new Scheduler(1, 5)
    await s.acquire(1)
    const ac = new AbortController()
    const p = s.acquire(2, ac.signal)
    ac.abort()
    await expect(p).rejects.toThrow(/aborted/)
    expect(s.queue()).toEqual([])
  })

  it('grows live', async () => {
    const s = new Scheduler(1, 5)
    await s.acquire(1)
    const p = s.acquire(2)
    s.resize(2, 5)
    await expect(p).resolves.toBe(1)
  })
})

describe('upstream key', () => {
  const key = 'sk-test-1234'
  const withKey = applyEnv(defaultConfig(), { MOCKOLLA_UPSTREAM_KEY: key })

  it('is read from .env, trimmed, and empty by default', () => {
    expect(defaultConfig().upstreamKey).toBe('')
    expect(withKey.upstreamKey).toBe(key)
    expect(applyEnv(defaultConfig(), { MOCKOLLA_UPSTREAM_KEY: `  ${key}	` }).upstreamKey).toBe(key)
    expect(applyEnv(withKey, { MOCKOLLA_UPSTREAM_KEY: '' }).upstreamKey).toBe('')
  })

  it('refuses a value that would break the header, keeping the key it had', () => {
    // A header injection, a NUL and a DEL.
    for (const bad of [`${key}\r\nX-Evil: 1`, 'a\u0000b', 'a\u007fb'])
      expect(applyEnv(withKey, { MOCKOLLA_UPSTREAM_KEY: bad }).upstreamKey).toBe(key)
  })

  it('is never shown: the mask hides a set key and leaves "no key" as it is', () => {
    expect(maskKey(withKey).upstreamKey).toBe(KEY_MASK)
    expect(JSON.stringify(maskKey(withKey))).not.toContain(key)
    const none = defaultConfig()
    expect(maskKey(none)).toBe(none)
  })

  it('keeps the key when the mask comes back, e.g. a form saved as it was shown', () => {
    expect(patchConfig(withKey, { upstreamKey: KEY_MASK }).upstreamKey).toBe(key)
    expect(patchConfig(withKey, { ...maskKey(withKey), ttftMs: 5 })).toMatchObject({
      upstreamKey: key,
      ttftMs: 5,
    })
    expect(patchConfig(withKey, { upstreamKey: 'sk-new' }).upstreamKey).toBe('sk-new')
    expect(patchConfig(withKey, { upstreamKey: '' }).upstreamKey).toBe('')
  })

  it('round-trips through .env, and a masked config writes no key', () => {
    const env = parseEnv(serializeEnv(withKey))
    expect(env.MOCKOLLA_UPSTREAM_KEY).toBe(key)
    expect(applyEnv(defaultConfig(), env).upstreamKey).toBe(key)
    expect(serializeEnv(maskKey(withKey))).not.toContain(key)
  })
})

describe('upstream paths', () => {
  it('sends /v1/... under the OpenAI base and the rest to the server root', () => {
    const cases: [string, string, string][] = [
      ['http://h:11434/v1', '/v1/chat/completions', 'http://h:11434/v1/chat/completions'],
      ['http://h:11434/v1', '/api/chat', 'http://h:11434/api/chat'],
      ['http://h:11434', '/v1/models', 'http://h:11434/v1/models'],
      ['http://h:11434', '/api/tags', 'http://h:11434/api/tags'],
      ['https://gpu/ollama/v1', '/api/ps', 'https://gpu/ollama/api/ps'],
      // Gemini's OpenAI base does not end in /v1: the client's /v1 is replaced by it.
      [
        'https://generativelanguage.googleapis.com/v1beta/openai',
        '/v1/chat/completions',
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      ],
      ['https://g/v1beta/openai', '/v1/models?page=2', 'https://g/v1beta/openai/models?page=2'],
      // Only a /v1 segment counts, not a path that merely starts with it.
      ['https://g/v1beta/openai', '/v1beta/x', 'https://g/v1beta/openai/v1beta/x'],
    ]
    for (const [up, path, want] of cases) expect(upstreamUrl(up, path)).toBe(want)
  })

  it('takes a bare origin as a server root with its OpenAI API under /v1', () => {
    expect(openaiBase('http://h:11434')).toBe('http://h:11434/v1')
    expect(openaiBase('http://h:11434/v1')).toBe('http://h:11434/v1')
    expect(openaiBase('https://g/v1beta/openai')).toBe('https://g/v1beta/openai')
  })
})

describe('model map', () => {
  it('keeps app=upstream pairs and drops the ones it cannot use', () => {
    expect(parseModelMap(' llama3.2:3b = gemini-2.5-flash ,*=gpt-x')).toEqual([
      'llama3.2:3b=gemini-2.5-flash',
      '*=gpt-x',
    ])
    expect(parseModelMap('no-equals, =to, from=, a b=c, a=b=c, x="y"')).toEqual([])
    // A name mapped twice keeps its first pair.
    expect(parseModelMap('m=a,m=b')).toEqual(['m=a'])
    expect(parseModelMap('')).toEqual([])
  })

  it('round-trips through .env and the UI', () => {
    const c = applyEnv(defaultConfig(), { MOCKOLLA_MODEL_MAP: 'm=a,*=b' })
    expect(c.modelMap).toEqual(['m=a', '*=b'])
    expect(applyEnv(defaultConfig(), parseEnv(serializeEnv(c))).modelMap).toEqual(['m=a', '*=b'])
    expect(patchConfig(c, { modelMap: ['x=y'] }).modelMap).toEqual(['x=y'])
    expect(patchConfig(c, { modelMap: [] }).modelMap).toEqual([])
    expect(defaultConfig().modelMap).toEqual([])
  })

  it('renames a model by its own pair first, then by *, and leaves the rest', () => {
    const map = ['*=fallback-model', 'llama3.2:3b=gemini-2.5-flash', 'qwen=q-cloud']
    expect(mapModel(map, 'llama3.2:3b')).toBe('gemini-2.5-flash')
    // Ollama's "name" and "name:latest" are one model.
    expect(mapModel(map, 'qwen:latest')).toBe('q-cloud')
    expect(mapModel(['qwen:latest=q'], 'qwen')).toBe('q')
    expect(mapModel(map, 'mistral')).toBe('fallback-model')
    expect(mapModel(['m=a'], 'other')).toBe('other')
    expect(mapModel([], 'm')).toBe('m')
    // No model at all is not renamed into one.
    expect(mapModel(map, '')).toBe('')
  })
})

describe('model map, as Ollama names models', () => {
  it('drops a second pair for the same model, :latest or not, and skips "*" when asked', () => {
    expect(parseModelMap('m=a, m:latest=b')).toEqual(['m=a'])
    expect(parseModelMap('m:latest=a, m=b')).toEqual(['m:latest=a'])
    expect(mapModel(['*=w', 'm=a'], 'other', false)).toBe('other')
    expect(mapModel(['*=w', 'm=a'], 'm', false)).toBe('a')
  })
})
