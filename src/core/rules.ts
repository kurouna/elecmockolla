import type {
  FaultMode,
  KeywordEntry,
  LoremLang,
  MatchKind,
  MatchTarget,
  ResponseKind,
  ResponseSpec,
  Rule,
  RulesFile,
} from '../shared/types.ts'
import { FAULT_MODES } from './config.ts'
import { chatRules, elecRules } from './default-rules.ts'
import { defaultIds, missingFrom, type Offer, takeFrom } from './rules-merge.ts'

export { FAULT_MODES }

const MATCH_KINDS: readonly MatchKind[] = ['regex', 'contains', 'always']
const TARGETS: readonly MatchTarget[] = ['last', 'all', 'system']
const RESPONSE_KINDS: readonly ResponseKind[] = ['template', 'lorem', 'json', 'echo', 'tool']
const LANGS: readonly LoremLang[] = ['auto', 'en', 'ja']

/**
 * The rules a fresh install starts with: slash commands for each feature, replies for
 * everyday chat (default-rules.ts), and the ELEC system of elecdex, off, at the end.
 */
export function defaultRules(): RulesFile {
  const rules: RulesFile = {
    version: 1,
    rules: [
      {
        id: 'echo',
        name: '/echo <text>',
        enabled: true,
        match: { kind: 'regex', pattern: '^/echo\\s+([\\s\\S]*)' },
        response: { kind: 'template', text: '$1' },
      },
      {
        id: 'json',
        name: '/json',
        enabled: true,
        match: { kind: 'regex', pattern: '^/json\\b' },
        response: {
          kind: 'json',
          text: '{\n  "id": "{{uuid}}",\n  "answer": "{{lorem:8}}",\n  "score": {{int:1-100}},\n  "tags": ["mock", "{{pick:alpha|beta|gamma}}"]\n}',
        },
      },
      {
        id: 'code',
        name: '/code (markdown)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/code\\b' },
        response: {
          kind: 'template',
          text: 'Here is an example:\n\n```ts\nexport function add(a: number, b: number): number {\n  return a + b\n}\n```\n\n- It is **typed**\n- It is *pure*\n- It returns `a + b`',
        },
      },
      {
        id: 'slow',
        name: '/slow (slow stream)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/slow\\b' },
        response: { kind: 'lorem', text: '', lang: 'auto', minWords: 40, maxWords: 60 },
        ttftMs: 2500,
        tps: 4,
      },
      {
        id: 'error',
        name: '/error [status] (HTTP 500, or 429, 401…)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/error\\b(?:\\s+(\\d{3}))?' },
        response: { kind: 'template', text: '' },
        fault: 'error500',
        status: '$1',
      },
      {
        id: 'cut',
        name: '/cut (disconnect mid-stream)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/cut\\b' },
        response: { kind: 'lorem', text: '', lang: 'auto', minWords: 60, maxWords: 80 },
        fault: 'disconnect',
      },
      {
        id: 'long-n',
        name: '/long <words> (a reply of that length)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/long\\s+(\\d{1,5})\\b' },
        response: { kind: 'template', text: '{{lorem-auto:$1}}' },
      },
      {
        id: 'long',
        name: '/long (a long reply)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/long\\b' },
        response: { kind: 'lorem', text: '', lang: 'auto', minWords: 1000, maxWords: 1000 },
      },
      {
        id: 'markdown',
        name: '/markdown (every Markdown element)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/(?:markdown|md)\\b' },
        response: {
          kind: 'template',
          text: [
            '# Heading 1',
            '## Heading 2',
            '### Heading 3',
            '',
            'A paragraph with **bold**, *italic*, ***both***, ~~strikethrough~~, `inline code` and a [link](https://example.com).',
            'A second line in the same paragraph.',
            '',
            '> A quote.',
            '> > A quote inside a quote.',
            '',
            '- A list item',
            '  - A nested item',
            '    - Nested deeper',
            '- Another item',
            '',
            '1. First',
            '2. Second',
            '   1. Nested and numbered',
            '',
            '- [x] A done task',
            '- [ ] A task to do',
            '',
            '| Left | Center | Right |',
            '|:---|:---:|---:|',
            '| a | b | c |',
            '| longer cell | `code` | **bold** |',
            '',
            '```ts',
            'export function add(a: number, b: number): number {',
            '  return a + b',
            '}',
            '```',
            '',
            '```',
            'a code block with no language',
            '```',
            '',
            '---',
            '',
            'Inline math $a^2 + b^2 = c^2$, an image ![alt text](https://example.com/image.png), a footnote[^1] and an HTML <kbd>Ctrl</kbd>.',
            '',
            '[^1]: The footnote.',
          ].join('\n'),
        },
      },
      {
        id: 'unicode',
        name: '/unicode (text that trips up rendering)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/unicode\\b' },
        response: {
          kind: 'template',
          text: [
            'Emoji: 😀 👍🏽 👨\u200d👩\u200d👧\u200d👦 🏳\ufe0f\u200d🌈 🇯🇵 ❤\ufe0f 1\ufe0f\u20e3',
            'Combining marks: e\u0301 (e + U+0301) vs é, n\u0303, Z\u0335\u0321a\u0336\u031bl\u0337\u0322g\u0334o\u0335',
            'Right to left: العربية · עברית · mixed: abc אבג 123',
            'Zero-width: [\u200b] zero-width space, [\u200d] joiner, [\u00ad] soft hyphen, [\ufeff] BOM',
            'Full and half width: ＡＢＣ１２３ ABC123 ｱｲｳｴｵ アイウエオ',
            'Beyond the BMP: 𠮷野家 𝕌𝕟𝕚𝕔𝕠𝕕𝕖 𝄞',
            'Scripts: 日本語 한국어 中文 ไทย हिन्दी Ελληνικά Русский',
            'Symbols: ∑ ∞ ≠ ≤ ≥ → ⇒ ✓ ✗ ° ± × ÷ ¥ € £',
            'Whitespace: [\t] tab, [\u00a0] no-break space, [\u3000] ideographic space',
            'A very long word: Supercalifragilisticexpialidocious_and_then_some_more_without_any_spaces_to_break_on',
          ].join('\n'),
        },
      },
      {
        id: 'empty',
        name: '/empty (an empty reply)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/empty\\b' },
        response: { kind: 'template', text: '' },
      },
      {
        id: 'tool',
        name: '/tool <name> [{json}] (any tool call)',
        enabled: true,
        match: {
          kind: 'regex',
          pattern:
            '^/tool\\s+(?<name>[A-Za-z_][\\w.-]{0,63})(?:\\s+(?<args>\\{[\\s\\S]*\\}))?\\s*$',
        },
        response: { kind: 'tool', toolName: '$<name>', text: '{{raw:$<args>}}' },
      },
      {
        id: 'greeting',
        name: 'Greeting',
        enabled: true,
        match: {
          kind: 'regex',
          // Time-of-day greetings (おはよう, good morning...) have rules of their own.
          pattern: '^\\s*(hi|hello|hey|やあ)(?![a-z])',
          flags: 'i',
        },
        response: {
          kind: 'template',
          text: '$1! I am a mock model ({{model}}) served by elecmockolla. How can I help you today?',
        },
      },
      {
        id: 'name',
        name: 'Capture a name',
        enabled: true,
        match: {
          kind: 'regex',
          pattern: '^[^\\n]*?(?:my name is|私の名前は)\\s*(?<name>[^\\s。、,.!?！？]+)',
          flags: 'i',
        },
        response: {
          kind: 'template',
          text: 'Nice to meet you, $<name>! / はじめまして、$<name> さん。',
        },
      },
      {
        id: 'weather-tool',
        name: 'Weather tool call',
        enabled: true,
        match: {
          kind: 'regex',
          // A city is named: 東京の天気, 大阪の明日の天気, weather in Paris. A time word is not
          // a city (明日の天気 names none), so that question gets the weather reply in words.
          pattern:
            '^[^\\n]*?(?:weather in ([A-Za-z ]+))|^[^\\n]*?(?<![^\\s、。の])(?!(?:今日|きょう|明日|あした|あす|明後日|あさって|今夜|今晩|今週|来週|週末|今朝|昼|夜|午前|午後)の)([^\\sの、。？?]+?)の(?:(?:今日|きょう|明日|あした|あす|明後日|あさって|今夜|今晩|今週|来週|週末|今朝|昼|夜|午前|午後)の)?天気',
          flags: 'i',
        },
        response: {
          kind: 'tool',
          toolName: 'get_weather',
          text: '{"city": "$1$2", "unit": "celsius"}',
        },
      },
      ...chatRules(),
      ...elecRules(),
    ],
    keywords: [
      { id: 'kw-q-ja', enabled: true, keyword: '？', reply: 'いい質問ですね。{{lorem-ja:12}}' },
      { id: 'kw-q-en', enabled: true, keyword: '?', reply: 'Good question. {{lorem:20}}' },
      { id: 'kw-thanks-ja', enabled: true, keyword: 'ありがとう', reply: 'どういたしまして！' },
      { id: 'kw-thanks-en', enabled: true, keyword: 'thank', reply: "You're welcome!" },
    ],
    fallback: { kind: 'lorem', text: '', lang: 'auto', minWords: 20, maxWords: 60 },
  }
  return { ...rules, seenDefaults: defaultIds(rules) }
}

/** Built-in rules and keywords a rules file has not been offered yet. */
export const missingDefaults = (current: RulesFile, defaults: RulesFile = defaultRules()): Offer =>
  missingFrom(current, defaults)

/** {@link takeFrom} against the built-in rules. */
export const takeDefaults = (
  current: RulesFile,
  add: boolean,
  defaults: RulesFile = defaultRules(),
): RulesFile => takeFrom(current, add, defaults)

// --- validation -------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d

export class RulesError extends Error {}

function normalizeResponse(v: unknown, where: string): ResponseSpec {
  if (!isObj(v)) throw new RulesError(`${where}: "response" must be an object`)
  const r: ResponseSpec = {
    kind: oneOf(v.kind, RESPONSE_KINDS, 'template'),
    text: str(v.text),
  }
  if (r.kind === 'tool') {
    r.toolName = str(v.toolName)
    if (!r.toolName) throw new RulesError(`${where}: a tool response needs "toolName"`)
  }
  if (r.kind === 'lorem') {
    r.lang = oneOf(v.lang, LANGS, 'auto')
    const min = num(v.minWords) ?? 20
    r.minWords = Math.round(min)
    r.maxWords = Math.max(r.minWords, Math.round(num(v.maxWords) ?? min))
  }
  const think = str(v.think)
  if (think) r.think = think
  return r
}

/** Returns the error message for an invalid regex, or '' when it compiles. */
export function regexError(pattern: string, flags = ''): string {
  try {
    new RegExp(pattern, flags)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function normalizeRule(v: unknown, i: number): Rule {
  const where = `rules[${i}]`
  if (!isObj(v)) throw new RulesError(`${where} must be an object`)
  const rule: Rule = {
    id: str(v.id) || `rule-${i + 1}`,
    name: str(v.name) || str(v.id) || `Rule ${i + 1}`,
    enabled: v.enabled !== false,
    match: normalizeMatch(v, where),
    response: normalizeResponse(v.response, where),
  }
  const status = str(v.status).trim()
  if (status) rule.status = status.slice(0, 40)
  const ttft = num(v.ttftMs)
  if (ttft !== undefined) rule.ttftMs = ttft
  const tps = num(v.tps)
  if (tps !== undefined) rule.tps = tps
  if (FAULT_MODES.includes(v.fault as FaultMode)) rule.fault = v.fault as FaultMode
  return rule
}

function normalizeMatch(v: Obj, where: string): Rule['match'] {
  const m = isObj(v.match) ? v.match : {}
  const match: Rule['match'] = {
    kind: oneOf(m.kind, MATCH_KINDS, 'regex'),
    pattern: str(m.pattern),
  }
  const flags = str(m.flags).replace(/[^dgimsuvy]/g, '')
  if (flags) match.flags = flags
  if (m.target !== undefined) match.target = oneOf(m.target, TARGETS, 'last')
  const model = str(m.model)
  if (model) match.model = model
  if (match.kind === 'regex') {
    const err = regexError(match.pattern, flags.replace('g', ''))
    if (err) throw new RulesError(`${where} (${str(v.name, str(v.id))}): ${err}`)
  }
  if (match.model) {
    const err = regexError(match.model, 'i')
    if (err) throw new RulesError(`${where}: model pattern: ${err}`)
  }
  return match
}

function normalizeKeyword(v: unknown, i: number): KeywordEntry {
  if (!isObj(v)) throw new RulesError(`keywords[${i}] must be an object`)
  return {
    id: str(v.id) || `kw-${i + 1}`,
    enabled: v.enabled !== false,
    keyword: str(v.keyword),
    reply: str(v.reply),
  }
}

/** Validates anything parsed from rules.json (or sent by the UI) into a RulesFile. Throws RulesError. */
export function normalizeRules(v: unknown): RulesFile {
  if (!isObj(v) || !Array.isArray(v.rules))
    throw new RulesError('not a rules file: it needs a "rules" array')
  const rules = Array.isArray(v.rules) ? v.rules.map(normalizeRule) : []
  const keywords = Array.isArray(v.keywords) ? v.keywords.map(normalizeKeyword) : []
  const fallback =
    v.fallback === undefined ? defaultRules().fallback : normalizeResponse(v.fallback, 'fallback')
  const ids = new Set<string>()
  for (const r of rules) {
    if (ids.has(r.id)) throw new RulesError(`duplicate rule id "${r.id}"`)
    ids.add(r.id)
  }
  const out: RulesFile = { version: 1, rules, keywords, fallback }
  if (Array.isArray(v.seenDefaults))
    out.seenDefaults = [
      ...new Set(v.seenDefaults.filter((x): x is string => typeof x === 'string')),
    ].slice(0, 5000)
  return out
}

export function parseRules(json: string): RulesFile {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    throw new RulesError(`rules file is not valid JSON: ${e instanceof Error ? e.message : e}`)
  }
  return normalizeRules(data)
}
