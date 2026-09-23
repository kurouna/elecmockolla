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

export const FAULT_MODES: readonly FaultMode[] = ['error500', 'disconnect', 'hang', 'malformed']
const MATCH_KINDS: readonly MatchKind[] = ['regex', 'contains', 'always']
const TARGETS: readonly MatchTarget[] = ['last', 'all', 'system']
const RESPONSE_KINDS: readonly ResponseKind[] = ['template', 'lorem', 'json', 'echo', 'tool']
const LANGS: readonly LoremLang[] = ['auto', 'en', 'ja']

/** The rules a fresh install starts with: one of each feature, handy for demos. */
/**
 * Replies for the ELEC system pane of elecdex: three units (LOGOS, ETHOS, PATHOS)
 * vote on a motion over the OpenAI chat API. Each unit is told who it is in the
 * system prompt ("You are UNIT-1 LOGOS.") and gets "MOTION:\n..." as the user
 * message; the second round adds the others' statements and "vote again". A reply
 * is a short statement in the motion's language, then two lines elecdex reads:
 * "VERDICT: APPROVE|REJECT|ABSTAIN" and "CONFIDENCE: 0-100". Each unit leans its
 * own way, so the council does not always agree.
 *
 * These come first: a motion like "明日の天気で..." must not reach the weather tool.
 */
const JA = '[\\u3040-\\u30ff\\u3400-\\u9fff]'
const VOTE = (verdicts: string, confidence: string) =>
  `\n\nVERDICT: {{pick:${verdicts}}}\nCONFIDENCE: {{int:${confidence}}}`

interface ElecUnit {
  code: string
  name: string
  verdicts: string
  confidence: string
  ja: string
  en: string
}

const ELEC_UNITS: ElecUnit[] = [
  {
    code: 'UNIT-1',
    name: 'LOGOS',
    // The scientist: even-handed, sure only when the facts are.
    verdicts: 'APPROVE|APPROVE|APPROVE|REJECT|REJECT|REJECT|ABSTAIN',
    confidence: '45-92',
    ja: 'LOGOS として、この議案を根拠・実現可能性・コスト・リスクの面から検討しました。{{pick:測定できる根拠はある程度そろっていますが、長期的な効果には不確かさが残ります。|想定される利点ははっきりしていますが、コストとリスクの見積もりには幅があります。|論理としては筋が通っていますが、前提となるデータが十分とは言えません。|実現の手段は具体的で、失敗したときの損失も見積もれます。}}{{pick:希望的観測を除いて判断しました。|数字で説明できる範囲で判断しました。|検証できる事実を優先して判断しました。}}',
    en: 'As LOGOS, I weighed this motion on evidence, feasibility, cost and risk. {{pick:The measurable evidence is reasonable, but the long-term effect is still uncertain.|The benefits are clear, while the estimates of cost and risk vary widely.|The reasoning holds, but the data it rests on is thin.|The means are concrete, and the loss if it fails can be estimated.}} {{pick:Setting wishful thinking aside, this is my verdict.|I judged it on what the numbers can support.|I gave weight to what can be verified.}}',
  },
  {
    code: 'UNIT-2',
    name: 'ETHOS',
    // The guardian: cautious, rejects more often than not.
    verdicts: 'APPROVE|APPROVE|REJECT|REJECT|REJECT|ABSTAIN',
    confidence: '50-95',
    ja: 'ETHOS として、この議案が誰に影響し、その結果を誰が負うのかを考えました。{{pick:関わる人への公平さは概ね保たれますが、立場の弱い人への配慮が十分かが気がかりです。|今の人々だけでなく、将来の人々への責任も考える必要があります。|義務と公正さの観点では、手続きの透明性が鍵になります。|約束を守り、迷惑を掛けないという点では筋が通っています。}}{{pick:それが正しいかどうかを基準に判断しました。|影響を受ける人の立場から判断しました。|長い目で見た責任を重く見て判断しました。}}',
    en: 'As ETHOS, I asked whom this motion touches and who bears its consequences. {{pick:It is broadly fair, but I am not sure the most vulnerable are protected.|We owe something not only to people now but to those who come later.|On duty and fairness, the key is whether the process is transparent.|It keeps faith with the promises made and harms no one who has not agreed.}} {{pick:I judged it by whether it is right.|I judged it from the side of those it affects.|I gave weight to the long-term responsibility.}}',
  },
  {
    code: 'UNIT-3',
    name: 'PATHOS',
    // The heart: follows the gut, approves more often than not.
    verdicts: 'APPROVE|APPROVE|APPROVE|APPROVE|REJECT|REJECT|ABSTAIN',
    confidence: '35-90',
    ja: 'PATHOS として、この決断がそれと共に生きる人にとって何を意味するかを感じ取ろうとしました。{{pick:数字には表れない期待と不安が、どちらも強く感じられます。|直感は、この決断が本当の気持ちに沿うかどうかを問うています。|やりたいという気持ちは確かにありますが、迷いも残っています。|これを選べば、後で振り返ったときに後悔は少ないはずです。}}{{pick:数字が語らないところは、直感を信じます。|最後は心の声に従いました。|気持ちの重さを大切にして判断しました。}}',
    en: 'As PATHOS, I tried to feel what this decision means to the person who lives with it. {{pick:There is hope and worry here that no number shows.|My instinct asks whether this is what they truly want.|The wish to do it is real, and so is the doubt.|Choose this, and there will be little to regret looking back.}} {{pick:Where the numbers are silent, I trust the gut.|In the end I followed the heart.|I gave weight to how much it matters to them.}}',
  },
]

export function elecRules(): Rule[] {
  const round2 = (lang: 'ja' | 'en'): Rule => ({
    id: `elec-round2-${lang}`,
    name: `ELEC · round 2 (${lang})`,
    enabled: true,
    match: {
      kind: 'regex',
      target: 'all',
      pattern:
        lang === 'ja'
          ? `You are UNIT-\\d (?<unit>[A-Z]+)\\.[\\s\\S]*MOTION:\\n(?=[\\s\\S]*${JA})[\\s\\S]*vote again`
          : 'You are UNIT-\\d (?<unit>[A-Z]+)\\.[\\s\\S]*MOTION:\\n[\\s\\S]*vote again',
    },
    response: {
      kind: 'template',
      text:
        (lang === 'ja'
          ? '$<unit> として、他のユニットの第1ラウンドの意見を読み直しました。{{pick:新しい論点には一理ありますが、私の見立てを覆すほどではありません。|指摘された懸念はもっともで、判断を見直しました。|意見は分かれていますが、自分の立場から改めて判断します。}}'
          : "As $<unit>, I have read the other units' statements from the first round. {{pick:Their points have merit, but not enough to overturn my view.|The concerns they raise are fair, and I have reconsidered.|We disagree, so I judge again from my own standpoint.}}") +
        VOTE('APPROVE|APPROVE|REJECT|REJECT|ABSTAIN', '45-95'),
    },
  })
  const unit = (u: ElecUnit, lang: 'ja' | 'en'): Rule => ({
    id: `elec-${u.name.toLowerCase()}-${lang}`,
    name: `ELEC · ${u.name} (${lang})`,
    enabled: true,
    match: {
      kind: 'regex',
      target: 'all',
      pattern: `You are ${u.code} ${u.name}\\.[\\s\\S]*MOTION:\\n${lang === 'ja' ? `(?=[\\s\\S]*${JA})` : ''}`,
    },
    response: { kind: 'template', text: u[lang] + VOTE(u.verdicts, u.confidence) },
  })
  return [round2('ja'), round2('en'), ...ELEC_UNITS.flatMap((u) => [unit(u, 'ja'), unit(u, 'en')])]
}

export function defaultRules(): RulesFile {
  return {
    version: 1,
    rules: [
      ...elecRules(),
      {
        id: 'greeting',
        name: 'Greeting',
        enabled: true,
        match: {
          kind: 'regex',
          pattern: '^\\s*(hi|hello|hey|こんにちは|こんばんは|おはよう)',
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
          pattern: '(?:my name is|私の名前は)\\s*(?<name>[^\\s。、,.!?！？]+)',
          flags: 'i',
        },
        response: {
          kind: 'template',
          text: 'Nice to meet you, $<name>! / はじめまして、$<name> さん。',
        },
      },
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
        id: 'weather-tool',
        name: 'Weather tool call',
        enabled: true,
        match: {
          kind: 'regex',
          pattern: '(?:weather in ([A-Za-z ]+))|(?:(\\S+?)の天気)',
          flags: 'i',
        },
        response: {
          kind: 'tool',
          toolName: 'get_weather',
          text: '{"city": "$1$2", "unit": "celsius"}',
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
    ],
    keywords: [
      { id: 'kw-q-ja', enabled: true, keyword: '？', reply: 'いい質問ですね。{{lorem-ja:12}}' },
      { id: 'kw-q-en', enabled: true, keyword: '?', reply: 'Good question. {{lorem:20}}' },
      { id: 'kw-thanks-ja', enabled: true, keyword: 'ありがとう', reply: 'どういたしまして！' },
      { id: 'kw-thanks-en', enabled: true, keyword: 'thank', reply: "You're welcome!" },
    ],
    fallback: { kind: 'lorem', text: '', lang: 'auto', minWords: 20, maxWords: 60 },
  }
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
  return { version: 1, rules, keywords, fallback }
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
