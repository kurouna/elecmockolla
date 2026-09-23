import OpenAI from 'openai'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyPreset, defaultConfig, presetById } from '../../src/core/config.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { MockServer } from '../../src/core/server.ts'

// The ELEC system pane of elecdex (src/shared/elec.ts there), as it asks each unit.
const CONTRACT = [
  'You are one of the three units of the ELEC system, a council that decides on a motion by vote.',
  'Judge the motion from your own standpoint, given below.',
  'Write a short statement - at most 120 words - in the language the motion is written in.',
  'Then end with exactly these two lines, in English whatever the language of the statement:',
  'VERDICT: APPROVE or REJECT or ABSTAIN',
  'CONFIDENCE: a whole number from 0 to 100',
].join('\n')
const UNITS = ['UNIT-1 LOGOS', 'UNIT-2 ETHOS', 'UNIT-3 PATHOS']
const system = (unit: string) => `${CONTRACT}\n\nYou are ${unit}. Your standpoint:\nWhatever.`
const round2 = (motion: string) =>
  [
    `MOTION:\n${motion}`,
    "The other units' statements in the first round:\n\n[UNIT-2 ETHOS · REJECT]\nNo.",
    'Your own statement in the first round:\n\n[UNIT-1 LOGOS · APPROVE]\nYes.',
    'Consider what they said and vote again. You may keep your verdict or change it.',
  ].join('\n\n')

// elecdex's readVote: the last VERDICT and CONFIDENCE lines.
const VERDICT_LINE =
  /^[\s>*_#`-]*(?:verdict|判定|評決)[\s*_`]*[:：\-–—]?[\s*_`]*([a-z]+|承認|賛成|否決|反対|棄権)/i
const CONFIDENCE_LINE = /^[\s>*_#`-]*(?:confidence|確信度)[\s*_`]*[:：\-–—]?[\s*_`]*(\d{1,3})/i
function readVote(text: string) {
  const lines = text.split('\n')
  const verdict = lines.map((l) => VERDICT_LINE.exec(l)?.[1]?.toLowerCase()).findLast(Boolean)
  const confidence = lines.map((l) => CONFIDENCE_LINE.exec(l)?.[1]).findLast(Boolean)
  return { verdict, confidence: confidence === undefined ? undefined : Number(confidence) }
}

describe('the ELEC system of elecdex', () => {
  let server: MockServer
  let openai: OpenAI

  beforeAll(async () => {
    const instant = presetById('instant')
    if (!instant) throw new Error('no instant preset')
    // They ship off and last; turned on, the everyday rules above must not catch a motion.
    const rules = defaultRules()
    for (const r of rules.rules) if (r.id.startsWith('elec-')) r.enabled = true
    server = new MockServer({
      config: { ...applyPreset(defaultConfig(), instant), port: 0 },
      rules,
    })
    openai = new OpenAI({ baseURL: `${await server.start()}/v1`, apiKey: 'x' })
  })
  afterAll(() => server.stop())

  async function ask(unit: string, user: string) {
    let text = ''
    const stream = await openai.chat.completions.create({
      model: 'llama3.2:3b',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: system(unit) },
        { role: 'user', content: user },
      ],
    })
    for await (const c of stream) text += c.choices[0]?.delta.content ?? ''
    return { text, rule: server.monitor.recent().at(-1)?.match?.id }
  }

  it('ships the ELEC rules off, at the end of the list', () => {
    const ids = defaultRules().rules.map((r) => r.id)
    const elec = defaultRules().rules.filter((r) => r.id.startsWith('elec-'))
    expect(elec).toHaveLength(8)
    expect(elec.every((r) => !r.enabled)).toBe(true)
    expect(ids.slice(-8)).toEqual(elec.map((r) => r.id))
  })

  it('answers each unit in its own voice, with a vote elecdex can read', async () => {
    for (const unit of UNITS) {
      const name = unit.split(' ')[1]?.toLowerCase()
      // A Japanese motion about the weather must not reach the weather tool.
      const ja = await ask(unit, 'MOTION:\n明日の天気が晴れなら、チームでピクニックに行くべきか？')
      expect(ja.rule).toBe(`elec-${name}-ja`)
      expect(ja.text).toMatch(/[ぁ-ん]/)
      expect(ja.text).toMatch(/\n\nVERDICT: (APPROVE|REJECT|ABSTAIN)\nCONFIDENCE: \d{1,3}$/)
      const vote = readVote(ja.text)
      expect(['approve', 'reject', 'abstain']).toContain(vote.verdict)
      expect(vote.confidence).toBeGreaterThanOrEqual(0)
      expect(vote.confidence).toBeLessThanOrEqual(100)

      const en = await ask(unit, 'MOTION:\nShould we rewrite the backend in Rust?')
      expect(en.rule).toBe(`elec-${name}-en`)
      expect(en.text).not.toMatch(/[ぁ-ん]/)
      expect(readVote(en.text).verdict).toBeDefined()
    }
  })

  it('answers the second round as a second round', async () => {
    const ja = await ask(UNITS[0] ?? '', round2('リモートワークを週3日に増やすべきか？'))
    expect(ja.rule).toBe('elec-round2-ja')
    expect(ja.text.startsWith('LOGOS として、他のユニット')).toBe(true)
    expect(readVote(ja.text).verdict).toBeDefined()

    const en = await ask(UNITS[2] ?? '', round2('Should we adopt a four-day week?'))
    expect(en.rule).toBe('elec-round2-en')
    expect(en.text.startsWith('As PATHOS,')).toBe(true)
  })

  it('leaves other prompts to the other rules', async () => {
    const r = await openai.chat.completions.create({
      model: 'llama3.2:3b',
      messages: [{ role: 'user', content: 'MOTION:\nhello' }],
    })
    expect(server.monitor.recent().at(-1)?.match?.id ?? '').not.toMatch(/^elec-/)
    expect(r.choices[0]?.message.content).toBeTruthy()
  })
})
