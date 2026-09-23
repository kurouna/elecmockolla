import { describe, expect, it } from 'vitest'
import {
  defaultRules,
  missingDefaults,
  normalizeRules,
  parseRules,
  takeDefaults,
} from '../../src/core/rules.ts'
import { fingerprint } from '../../src/core/rules-merge.ts'
import type { Rule, RulesFile } from '../../src/shared/types.ts'

const rule = (id: string): Rule => ({
  id,
  name: id,
  enabled: true,
  match: { kind: 'contains', pattern: id },
  response: { kind: 'template', text: id },
})

/** A rules file from an older version: some defaults, a user rule, no seenDefaults. */
function olderFile(): RulesFile {
  const d = defaultRules()
  const keep = new Set(['echo', 'json', 'greeting', 'time-ja', 'time-en'])
  const { seenDefaults: _drop, ...rest } = d
  return {
    ...rest,
    rules: [rule('mine'), ...d.rules.filter((r) => keep.has(r.id))],
    keywords: d.keywords.slice(0, 2),
  }
}

describe('new built-in rules for an existing rules file', () => {
  it('offers nothing to a fresh file', () => {
    const m = missingDefaults(defaultRules())
    expect(m.rules).toEqual([])
    expect(m.keywords).toEqual([])
  })

  it('offers the defaults an older file does not have', () => {
    const m = missingDefaults(olderFile())
    expect(m.rules.map((r) => r.id)).toContain('myname-ja')
    expect(m.rules.map((r) => r.id)).not.toContain('echo')
    expect(m.keywords.map((k) => k.id)).toEqual(['kw-thanks-ja', 'kw-thanks-en'])
  })

  it('adds them in their places and keeps the user rules and edits', () => {
    const old = olderFile()
    const greeting = old.rules.find((r) => r.id === 'greeting')
    if (greeting) greeting.response.text = 'my own greeting'
    const merged = takeDefaults(old, true)
    const ids = merged.rules.map((r) => r.id)
    expect(ids).toHaveLength(defaultRules().rules.length + 1)
    expect(ids[0]).toBe('mine')
    // A default lands after the nearest default before it: myname-ja after nicetomeet-en.
    expect(ids.indexOf('myname-ja')).toBe(ids.indexOf('nicetomeet-en') + 1)
    expect(ids.slice(-8).every((id) => id.startsWith('elec-'))).toBe(true)
    expect(merged.rules.find((r) => r.id === 'greeting')?.response.text).toBe('my own greeting')
    expect(missingDefaults(merged).rules).toEqual([])
    expect(parseRules(JSON.stringify(merged))).toEqual(normalizeRules(merged))
  })

  it('remembers a refusal, and never brings back a rule the user deleted', () => {
    const skipped = takeDefaults(olderFile(), false)
    expect(skipped.rules).toHaveLength(olderFile().rules.length)
    expect(missingDefaults(skipped).rules).toEqual([])

    const d = defaultRules()
    const deleted = { ...d, rules: d.rules.filter((r) => r.id !== 'joke-en') }
    expect(missingDefaults(deleted).rules).toEqual([])
  })

  it('updates a built-in rule the user never edited, and leaves an edited one alone', () => {
    // weather-tool as v0.0.1 shipped it: 明日の天気 read 明日 as a city.
    const d = normalizeRules(defaultRules())
    const old = structuredClone(d)
    const tool = old.rules.find((r) => r.id === 'weather-tool')
    if (!tool) throw new Error('no weather-tool')
    tool.match.pattern = String.raw`^[^\n]*?(?:weather in ([A-Za-z ]+))|^[^\n]*?(?:(\S+?)の天気)`
    tool.enabled = false
    const latest = d.rules.find((r) => r.id === 'weather-tool')
    expect(latest && fingerprint(latest)).not.toBe(fingerprint(tool))

    const offer = missingDefaults(old, d)
    expect(offer.updated.map((r) => r.id)).toEqual(['weather-tool'])
    const merged = takeDefaults(old, true, d)
    const now = merged.rules.find((r) => r.id === 'weather-tool')
    expect(now?.match.pattern).toContain('今日|きょう|明日')
    expect(now?.enabled).toBe(false)
    expect(merged.rules.map((r) => r.id)).toEqual(old.rules.map((r) => r.id))
    expect(missingDefaults(merged, d).updated).toEqual([])

    // Declining is remembered; an edited copy is never offered an update.
    expect(missingDefaults(takeDefaults(old, false, d), d).updated).toEqual([])
    const edited = structuredClone(old)
    const mine = edited.rules.find((r) => r.id === 'weather-tool')
    if (mine) mine.response.text = '{"city": "$1$2"}'
    expect(missingDefaults(edited, d).updated).toEqual([])
  })

  it('offers what a later version adds, even to a file that took the earlier ones', () => {
    const d = defaultRules()
    const later = { ...d, rules: [...d.rules, rule('brand-new')] }
    expect(missingDefaults(defaultRules(), later).rules.map((r) => r.id)).toEqual(['brand-new'])
  })
})
