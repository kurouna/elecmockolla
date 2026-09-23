import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine.ts'
import { defaultRules, missingDefaults, parseRules, takeDefaults } from '../../src/core/rules.ts'
import type { RulesFile } from '../../src/shared/types.ts'

/**
 * A rules.json exactly as v0.0.1 wrote it (its built-in rules, untouched). Users keep
 * their rules file across versions, so a fix to a built-in rule only reaches them
 * through the Rules page offer - this checks that it does.
 */
const v001 = (): RulesFile =>
  parseRules(readFileSync(new URL('../fixtures/rules-v0.0.1.json', import.meta.url), 'utf8'))

const ask = (rules: RulesFile, q: string) =>
  new Engine(rules, { seed: 1 }).plan({ model: 'm', last: q, all: q, system: '', think: false })

describe('a rules file from v0.0.1', () => {
  it('reads 明日 as a city before the update (the bug users saw)', () => {
    const p = ask(v001(), '明日の天気は？')
    expect(p.toolCalls[0]?.arguments).toMatchObject({ city: '明日' })
  })

  it('is offered the fixed weather rule and the new ones, and then answers in words', () => {
    const d = defaultRules()
    const offer = missingDefaults(v001(), d)
    expect(offer.updated.map((r) => r.id)).toContain('weather-tool')
    expect(offer.rules.map((r) => r.id)).toEqual(
      expect.arrayContaining(['weather-ja', 'weather-en']),
    )

    const taken = takeDefaults(v001(), true, d)
    for (const q of ['明日の天気は？', '今日の天気', '週末の天気はどう？']) {
      const p = ask(taken, q)
      expect(p.toolCalls, q).toEqual([])
      expect(p.text, q).toContain('晴れのち雨')
    }
    expect(ask(taken, '東京の天気は？').toolCalls[0]?.arguments).toMatchObject({ city: '東京' })
    expect(ask(taken, '大阪の明日の天気は？').toolCalls[0]?.arguments).toMatchObject({
      city: '大阪',
    })

    // Nothing left to offer, and the file answers every prompt as a fresh one does.
    const left = missingDefaults(taken, d)
    expect([...left.rules, ...left.updated, ...left.keywords]).toEqual([])
    for (const q of ['明日の天気は？', 'What is Kubernetes?', '星座占いして', 'テスト'])
      expect(ask(taken, q).match.id, q).toBe(ask(d, q).match.id)
  })
})
