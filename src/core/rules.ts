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
import { chatRules, elecRules } from './default-rules.ts'

export const FAULT_MODES: readonly FaultMode[] = ['error500', 'disconnect', 'hang', 'malformed']
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
        name: '/error (HTTP 500)',
        enabled: true,
        match: { kind: 'regex', pattern: '^/error\\b' },
        response: { kind: 'template', text: '' },
        fault: 'error500',
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
          pattern: '^[^\\n]*?(?:weather in ([A-Za-z ]+))|^[^\\n]*?(?:(\\S+?)の天気)',
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

const defaultIds = (r: RulesFile): string[] => [
  ...r.rules.map((x) => x.id),
  ...r.keywords.map((k) => k.id),
]

/** Built-in rules and keywords a rules file has not been offered yet. */
export function missingDefaults(
  current: RulesFile,
  defaults: RulesFile = defaultRules(),
): { rules: Rule[]; keywords: KeywordEntry[] } {
  const seen = new Set(current.seenDefaults ?? defaultIds(current))
  for (const id of defaultIds(current)) seen.add(id)
  return {
    rules: defaults.rules.filter((r) => !seen.has(r.id)),
    keywords: defaults.keywords.filter((k) => !seen.has(k.id)),
  }
}

/**
 * Offers the new built-in rules to a rules file: with `add`, they are put where they
 * stand among the defaults (after the nearest default before them that the file has,
 * else first), so the order still makes sense; without, they are only marked as seen.
 * Either way the user's own rules and edits stay as they are.
 */
export function takeDefaults(
  current: RulesFile,
  add: boolean,
  defaults: RulesFile = defaultRules(),
): RulesFile {
  const missing = missingDefaults(current, defaults)
  const rules = [...current.rules]
  if (add)
    for (const rule of missing.rules) {
      const at = defaults.rules.indexOf(rule)
      let after = -1
      for (let i = at - 1; i >= 0 && after < 0; i--) {
        const id = defaults.rules[i]?.id
        after = rules.findIndex((r) => r.id === id)
      }
      rules.splice(after + 1, 0, structuredClone(rule))
    }
  const keywords = add
    ? [...current.keywords, ...missing.keywords.map((k) => ({ ...k }))]
    : [...current.keywords]
  const seen = new Set([...(current.seenDefaults ?? defaultIds(current)), ...defaultIds(defaults)])
  return { ...current, rules, keywords, seenDefaults: [...seen] }
}

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
  const rule: Rule = {
    id: str(v.id) || `rule-${i + 1}`,
    name: str(v.name) || str(v.id) || `Rule ${i + 1}`,
    enabled: v.enabled !== false,
    match,
    response: normalizeResponse(v.response, where),
  }
  const ttft = num(v.ttftMs)
  if (ttft !== undefined) rule.ttftMs = ttft
  const tps = num(v.tps)
  if (tps !== undefined) rule.tps = tps
  if (FAULT_MODES.includes(v.fault as FaultMode)) rule.fault = v.fault as FaultMode
  return rule
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
  if (!isObj(v)) throw new RulesError('the rules file must be a JSON object')
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
