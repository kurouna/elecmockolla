import { describe, expect, it } from 'vitest'
import { calc, Engine, type Prompt, renderTemplate } from '../../src/core/engine.ts'
import { createRng } from '../../src/core/random.ts'
import { defaultRules, normalizeRules, parseRules, RulesError } from '../../src/core/rules.ts'
import { countTokens, loremJa, tokenize } from '../../src/core/text.ts'

const prompt = (last: string, extra: Partial<Prompt> = {}): Prompt => ({
  model: 'llama3.2:3b',
  last,
  all: last,
  system: '',
  think: false,
  ...extra,
})

describe('tokenize', () => {
  it('round-trips any text', () => {
    for (const s of [
      'Hello, world!',
      '  spaced  out  ',
      'こんにちは、世界。',
      'emoji 🎉 ok',
      'a\n\nb',
      '',
    ])
      expect(tokenize(s).join('')).toBe(s)
  })
  it('splits long words and CJK into several tokens', () => {
    expect(countTokens('internationalization')).toBeGreaterThan(2)
    expect(countTokens('東京都庁舎')).toBe(3)
  })
})

describe('renderTemplate', () => {
  const ctx = (groups: RegExpExecArray | null = null, json = false) => ({
    rng: createRng(1),
    prompt: prompt('hi'),
    groups,
    json,
    requestNo: 7,
  })
  it('expands groups and placeholders', () => {
    const g = /(?<who>\w+) (\w+)/.exec('alice bob')
    expect(renderTemplate('$1/$2/$<who>/$&/$$/{{model}}/{{n}}', ctx(g))).toBe(
      'alice/bob/alice/alice bob/$/llama3.2:3b/7',
    )
  })
  it('leaves unknown placeholders and groups without a regex alone', () => {
    expect(renderTemplate('{{nope}} $1', ctx())).toBe('{{nope}} $1')
  })
  it('escapes values inside JSON templates', () => {
    const g = /(.*)/.exec('say "hi"\n')
    const out = renderTemplate('{"q": "$1"}', ctx(g, true))
    expect(JSON.parse(out)).toEqual({ q: 'say "hi"' })
  })
  it('int and pick stay in range', () => {
    for (let i = 0; i < 50; i++) {
      const n = Number(renderTemplate('{{int:5-9}}', { ...ctx(), rng: Math.random }))
      expect(n).toBeGreaterThanOrEqual(5)
      expect(n).toBeLessThanOrEqual(9)
      expect(['a', 'b']).toContain(renderTemplate('{{pick:a|b}}', { ...ctx(), rng: Math.random }))
    }
  })
})

describe('Engine', () => {
  const engine = new Engine(defaultRules(), { seed: null })

  it('matches regex rules with capture groups', () => {
    const p = engine.plan(prompt('Hello!'))
    expect(p.match).toMatchObject({ source: 'rule', id: 'greeting' })
    expect(p.text.startsWith('Hello!')).toBe(true)
    expect(engine.plan(prompt('私の名前は太郎です')).text).toContain('太郎')
  })

  it('falls back to the keyword table, then to the fallback', () => {
    expect(engine.plan(prompt('これは何ですか？')).match).toMatchObject({
      source: 'keyword',
      id: 'kw-q-ja',
    })
    const f = engine.plan(prompt('tell me something'))
    expect(f.match.source).toBe('fallback')
    expect(f.text.length).toBeGreaterThan(20)
  })

  it('answers Japanese prompts with Japanese filler', () => {
    const f = engine.plan(prompt('説明してください'))
    expect(f.text).toMatch(/[぀-ヿ]/)
  })

  it('builds tool calls with arguments parsed as JSON', () => {
    const p = engine.plan(prompt('東京の天気を教えて'))
    expect(p.toolCalls).toEqual([
      { name: 'get_weather', arguments: { city: '東京', unit: 'celsius' } },
    ])
    const en = engine.plan(prompt("What's the weather in Paris"))
    expect(en.toolCalls[0]?.arguments).toMatchObject({ city: 'Paris' })
  })

  it('returns valid JSON for json rules and for format requests', () => {
    expect(() => JSON.parse(engine.plan(prompt('/json')).text)).not.toThrow()
    const wrapped = engine.plan(prompt('tell me', { format: 'json' }))
    expect(JSON.parse(wrapped.text)).toHaveProperty('response')
    const schema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'integer' },
        ok: { type: 'boolean' },
      },
    }
    const v = JSON.parse(engine.plan(prompt('hello', { format: schema })).text)
    expect(typeof v.title).toBe('string')
    expect(Number.isInteger(v.count)).toBe(true)
    expect(typeof v.ok).toBe('boolean')
  })

  it('produces thinking only when asked', () => {
    expect(engine.plan(prompt('hi')).thinking).toBe('')
    expect(engine.plan(prompt('hi', { think: true })).thinking.length).toBeGreaterThan(10)
  })

  it('carries rule timing and faults', () => {
    expect(engine.plan(prompt('/slow')).tps).toBe(4)
    expect(engine.plan(prompt('/error')).fault).toBe('error500')
  })

  it('is deterministic with a seed', () => {
    const seeded = new Engine(defaultRules(), { seed: 42 })
    const a = seeded.plan(prompt('anything at all')).text
    const b = seeded.plan(prompt('anything at all')).text
    expect(a).toBe(b)
    expect(seeded.plan(prompt('something else')).text).not.toBe(a)
  })

  it('skips disabled rules and filters by model', () => {
    const rules = defaultRules()
    rules.rules = [
      {
        id: 'a',
        name: 'a',
        enabled: false,
        match: { kind: 'always', pattern: '' },
        response: { kind: 'template', text: 'A' },
      },
      {
        id: 'b',
        name: 'b',
        enabled: true,
        match: { kind: 'always', pattern: '', model: '^qwen' },
        response: { kind: 'template', text: 'B' },
      },
      {
        id: 'c',
        name: 'c',
        enabled: true,
        match: { kind: 'contains', pattern: 'PING', flags: 'i' },
        response: { kind: 'template', text: 'pong' },
      },
    ]
    const e = new Engine(rules, { seed: 1 })
    expect(e.plan(prompt('x', { model: 'qwen3:8b' })).text).toBe('B')
    expect(e.plan(prompt('ping?')).text).toBe('pong')
  })
})

describe('rules validation', () => {
  it('accepts the defaults and round-trips them', () => {
    const r = defaultRules()
    expect(parseRules(JSON.stringify(r))).toEqual(r)
  })
  it('rejects broken regexes and duplicate ids with a clear message', () => {
    const bad = {
      rules: [
        {
          id: 'x',
          match: { kind: 'regex', pattern: '(' },
          response: { kind: 'template', text: '' },
        },
      ],
    }
    expect(() => normalizeRules(bad)).toThrow(RulesError)
    const dup = {
      rules: [
        { id: 'x', response: {} },
        { id: 'x', response: {} },
      ],
    }
    expect(() => normalizeRules(dup)).toThrow(/duplicate/)
  })
  it('fills in defaults for sparse input', () => {
    const r = normalizeRules({ rules: [{ response: { kind: 'lorem' } }] })
    expect(r.rules[0]).toMatchObject({
      id: 'rule-1',
      enabled: true,
      response: { minWords: 20, maxWords: 20 },
    })
    expect(r.fallback.kind).toBe('lorem')
  })
})

describe('lorem', () => {
  it('Japanese filler ends sentences properly', () => {
    const s = loremJa(createRng(3), 10)
    expect(s.endsWith('。')).toBe(true)
  })
})

describe('{{calc:...}}', () => {
  it('does arithmetic without evaluating code', () => {
    expect(calc('1+1')).toBe('2')
    expect(calc('2+3*4')).toBe('14')
    expect(calc('(2+3)*4')).toBe('20')
    expect(calc('１０÷４')).toBe('2.5')
    expect(calc('3×−2')).toBe('-6')
    expect(calc('0.1+0.2')).toBe('0.3')
    expect(calc('1/0')).toBeUndefined()
    expect(calc('1+')).toBeUndefined()
    expect(calc('process.exit()')).toBeUndefined()
    expect(calc('2**3')).toBeUndefined()
  })

  it('fills captured groups into the expression', () => {
    const rng = createRng(1)
    const groups = /(\d+)\+(?<b>\d+)/.exec('7+8')
    const ctx = {
      rng,
      prompt: { model: 'm', last: '', all: '', system: '', think: false },
      json: false,
      requestNo: 1,
      groups,
    }
    expect(renderTemplate('{{calc:$1+$<b>}}', ctx)).toBe('15')
    expect(renderTemplate('{{calc:not math}}', ctx)).toBe('?')
  })
})
