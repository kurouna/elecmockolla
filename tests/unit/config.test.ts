import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyEnv,
  defaultConfig,
  parseEnv,
  patchConfig,
  serializeEnv,
  upstreamRoot,
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
