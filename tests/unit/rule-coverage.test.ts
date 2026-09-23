import { describe, expect, it } from 'vitest'
import { Engine, type Prompt } from '../../src/core/engine.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { CASES } from './rule-cases.ts'

/**
 * Every built-in rule must be reachable: at least one prompt must land on it with the
 * whole list in place. A rule shadowed by an earlier one (order is priority) is dead and
 * fails here, and so does a new rule added without a sample.
 */

// The ELEC contract as elecdex sends it: the unit is named in the system prompt.
const elec = (unit: string, motion: string): Partial<Prompt> => {
  const system = `You are one of the three units of the ELEC system.\n\nYou are ${unit}. Your standpoint:\nWhatever.`
  const last = `MOTION:\n${motion}`
  return { system, last, all: `${system}\n${last}` }
}

/** Prompts for the rules chat-rules.test.ts does not already name. */
const MORE: [prompt: string | Partial<Prompt>, rule: string][] = [
  ['/echo hi', 'echo'],
  ['/code', 'code'],
  ['/slow', 'slow'],
  ['/error', 'error'],
  ['/cut', 'cut'],
  ['What color is an apple?', 'color-apple-en'],
  ['What color are bananas?', 'color-banana-en'],
  ['What color is snow?', 'color-snow-en'],
  ['What colors are traffic lights?', 'traffic-light-en'],
  ['What does a dog say?', 'animal-dog-en'],
  ['What does a cat say?', 'animal-cat-en'],
  ['牛は何て鳴く？', 'animal-cow-ja'],
  ['豚の鳴き声は？', 'animal-pig-ja'],
  ['What sound does a pig make?', 'animal-pig-en'],
  ['アヒルはなんて鳴く？', 'animal-duck-ja'],
  ['What does a duck say?', 'animal-duck-en'],
  ['ニワトリの鳴き声', 'animal-chicken-ja'],
  ['What does a rooster say?', 'animal-chicken-en'],
  ['What does a frog say?', 'animal-frog-en'],
  ['羊は何て鳴くの？', 'animal-sheep-ja'],
  ['What does a sheep say?', 'animal-sheep-en'],
  ['How many legs does an insect have?', 'legs-insect-en'],
  ['クモの足は何本？', 'legs-spider-ja'],
  ['How many legs does an octopus have?', 'legs-octopus-en'],
  ['猫の足は何本？', 'legs-dog-ja'],
  ['How many legs does a dog have?', 'legs-dog-en'],
  ['鳥の足は何本？', 'legs-bird-ja'],
  ['How many legs does a bird have?', 'legs-bird-en'],
  ['How many months are in a year?', 'year-en'],
  ['What are the four seasons?', 'seasons-en'],
  ['How many fingers do I have?', 'fingers-en'],
  [elec('UNIT-1 LOGOS', 'Should we adopt a four-day week?'), 'elec-logos-en'],
  [elec('UNIT-1 LOGOS', '週休3日制を導入すべきか？'), 'elec-logos-ja'],
  [elec('UNIT-2 ETHOS', 'Should we adopt a four-day week?'), 'elec-ethos-en'],
  [elec('UNIT-2 ETHOS', '週休3日制を導入すべきか？'), 'elec-ethos-ja'],
  [elec('UNIT-3 PATHOS', 'Should we adopt a four-day week?'), 'elec-pathos-en'],
  [elec('UNIT-3 PATHOS', '週休3日制を導入すべきか？'), 'elec-pathos-ja'],
  [
    elec(
      'UNIT-1 LOGOS',
      'Should we adopt a four-day week?\n\nConsider what they said and vote again.',
    ),
    'elec-round2-en',
  ],
  [elec('UNIT-2 ETHOS', '週休3日制を導入すべきか？\n\nConsider and vote again.'), 'elec-round2-ja'],
]

describe('every built-in rule', () => {
  // All on, ELEC included: a disabled rule must still be reachable once turned on.
  const rules = defaultRules()
  const all = { ...rules, rules: rules.rules.map((r) => ({ ...r, enabled: true })) }
  const engine = new Engine(all, { seed: 1 })
  const reach = (q: string | Partial<Prompt>) => {
    const p: Prompt =
      typeof q === 'string'
        ? { model: 'm', last: q, all: q, system: '', think: false }
        : { model: 'm', last: '', all: '', system: '', think: false, ...q }
    return engine.plan(p).match.id
  }
  const samples = [...CASES, ...MORE]

  it('has a sample prompt', () => {
    const covered = new Set(samples.map(([, id]) => id))
    const missing = rules.rules.map((r) => r.id).filter((id) => !covered.has(id))
    expect(
      missing,
      'add a sample for these rules to tests/unit/rule-cases.ts (or MORE here)',
    ).toEqual([])
  })

  it.each(samples.map(([q, id]) => [typeof q === 'string' ? q : `(${id})`, id, q] as const))(
    '%s reaches %s',
    (_label, id, q) => {
      expect(reach(q)).toBe(id)
    },
  )
})
