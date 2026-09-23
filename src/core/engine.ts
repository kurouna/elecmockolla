import type {
  FaultMode,
  MatchInfo,
  ResponseSpec,
  Rule,
  RulesFile,
  TestResult,
} from '../shared/types.ts'
import { createRng, hashString, pick, type Rng, randInt, uuid } from './random.ts'
import { hasJapanese, lorem } from './text.ts'

/** What the engine needs to know about a request, whatever API it came through. */
export interface Prompt {
  model: string
  /** The last user message, or the generate prompt. */
  last: string
  /** Every message, joined by newlines. */
  all: string
  system: string
  /** Seed from the request options, if any. */
  seed?: number | undefined
  /** Client asked for reasoning output. */
  think: boolean
  /** "json", a JSON schema, or undefined. */
  format?: unknown
  /**
   * The conversation ends with a tool result: the client ran the tool call and sent its
   * answer back. Tool-call rules then stand aside, so the reply is words, not the same
   * call again (which would loop forever).
   */
  afterTool?: boolean | undefined
}

export interface ToolCall {
  name: string
  arguments: unknown
}

/** A fully decided reply: the server only has to pace and format it. */
export interface Plan {
  match: MatchInfo
  text: string
  thinking: string
  toolCalls: ToolCall[]
  ttftMs?: number
  tps?: number
  fault?: FaultMode
  /** The HTTP status for an error500 fault, when the rule sets one. */
  errorStatus?: number
  /** A recorded reply: stream these pieces as they are instead of re-tokenizing the text. */
  chunks?: { t: string; think: boolean }[]
}

interface Ctx {
  rng: Rng
  prompt: Prompt
  groups: RegExpExecArray | null
  /** Escape substituted values for a JSON string literal. */
  json: boolean
  requestNo: number
}

const jsonEscape = (s: string): string => JSON.stringify(s).slice(1, -1)

/**
 * Arithmetic for {{calc:...}}: numbers, + - * / and parentheses, also as full-width
 * characters and × ÷ −. Parsed by hand, never evaluated as code. undefined when the
 * expression is not arithmetic or divides by zero.
 */
export function calc(expr: string): string | undefined {
  const src = expr
    .normalize('NFKC')
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−ー–—]/g, '-')
    .replace(/\s+/g, '')
  if (!src || src.length > 200 || /[^\d.+\-*/()]/.test(src)) return undefined
  let i = 0
  const peek = () => src[i]
  const num = (): number => {
    if (peek() === '(') {
      i++
      const v = sum()
      if (peek() !== ')') throw new Error('paren')
      i++
      return v
    }
    if (peek() === '-') {
      i++
      return -num()
    }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(i))
    if (!m) throw new Error('number')
    i += m[0].length
    return Number(m[0])
  }
  const product = (): number => {
    let v = num()
    while (peek() === '*' || peek() === '/') {
      const op = src[i++]
      const r = num()
      if (op === '/' && r === 0) throw new Error('zero')
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  const sum = (): number => {
    let v = product()
    while (peek() === '+' || peek() === '-') v = src[i++] === '+' ? v + product() : v - product()
    return v
  }
  try {
    const v = sum()
    if (i !== src.length || !Number.isFinite(v)) return undefined
    return String(Number(v.toFixed(10)))
  } catch {
    return undefined
  }
}

/** The most words one {{lorem:N}} makes. */
const MAX_LOREM = 20_000

function placeholder(expr: string, ctx: Ctx): string | undefined {
  const [name = '', ...rest] = expr.split(':')
  const arg = rest.join(':')
  const { rng, prompt } = ctx
  switch (name.trim()) {
    case 'prompt':
      return prompt.last
    case 'system':
      return prompt.system
    case 'model':
      return prompt.model
    case 'lorem':
      // Capped: /long 99999 must not build megabytes of text.
      return lorem(rng, Math.min(Number(arg) || 20, MAX_LOREM), 'en')
    case 'lorem-ja':
      return lorem(rng, Math.min(Number(arg) || 12, MAX_LOREM), 'ja')
    case 'lorem-auto':
      return lorem(rng, Math.min(Number(arg) || 20, MAX_LOREM), 'auto', prompt.last)
    case 'date':
      return new Date().toISOString().slice(0, 10)
    case 'time':
      return new Date().toTimeString().slice(0, 8)
    case 'now':
      return new Date().toISOString()
    case 'uuid':
      return uuid(rng)
    case 'n':
      return String(ctx.requestNo)
    case 'int': {
      const [a, b] = arg.split('-').map((x) => Number.parseInt(x, 10))
      const lo = Number.isFinite(a) ? (a as number) : 0
      const hi = Number.isFinite(b) ? (b as number) : lo + 100
      return String(randInt(rng, Math.min(lo, hi), Math.max(lo, hi)))
    }
    case 'pick': {
      const items = arg.split('|').map((s) => s.trim())
      return items.length ? pick(rng, items) : ''
    }
    case 'calc':
      return calc(arg) ?? '?'
    default:
      return undefined
  }
}

/**
 * Expands a reply template:
 *   $0..$99, $&   regex groups (only for regex rules)
 *   $<name>       named groups
 *   $$            a literal dollar
 *   {{prompt}} {{system}} {{model}} {{lorem:N}} {{lorem-ja:N}} {{lorem-auto:N}}
 *   {{date}} {{time}} {{now}} {{uuid}} {{n}} {{int:A-B}} {{pick:a|b|c}} {{calc:$1+$2}}
 * Unknown placeholders are left as they are.
 */
/** $1 and $<name> inside a placeholder's argument, from the regex groups. */
function fillGroups(expr: string, g: RegExpExecArray | null): string {
  if (!g || !expr.includes('$')) return expr
  return expr.replace(
    /\$<([A-Za-z_]\w*)>|\$(\d{1,2})/g,
    (_w, n?: string, d?: string) => (n !== undefined ? g.groups?.[n] : g[Number(d)]) ?? '',
  )
}

export function renderTemplate(tpl: string, ctx: Ctx): string {
  const esc = (s: string) => (ctx.json ? jsonEscape(s) : s)
  return tpl.replace(
    /\$\$|\$&|\$<([A-Za-z_][\w]*)>|\$(\d{1,2})|\{\{([^{}]+)\}\}/g,
    (whole, named: string | undefined, idx: string | undefined, expr: string | undefined) => {
      if (whole === '$$') return '$'
      const g = ctx.groups
      if (whole === '$&') return g ? esc(g[0]) : whole
      if (named !== undefined) return g ? esc(g.groups?.[named] ?? '') : whole
      if (idx !== undefined) return g ? esc(g[Number(idx)] ?? '') : whole
      const filled = fillGroups(expr ?? '', g)
      // {{raw:...}} goes in as it is, even into JSON: /tool passes a JSON object through.
      if (/^\s*raw\s*:/.test(filled)) return filled.replace(/^\s*raw\s*:/, '')
      const v = placeholder(filled, ctx)
      return v === undefined ? whole : esc(v)
    },
  )
}

/**
 * Compiled patterns, per rule object. Rules are replaced, never edited in place (a new
 * rules file is new objects), so an entry lives exactly as long as its rule and every
 * request reuses the RegExp instead of compiling each pattern again.
 */
const compiled = new WeakMap<Rule, { re?: RegExp; model?: RegExp }>()

function patterns(rule: Rule): { re?: RegExp; model?: RegExp } {
  let c = compiled.get(rule)
  if (!c) {
    c = {}
    if (rule.match.model) c.model = new RegExp(rule.match.model, 'i')
    if (rule.match.kind === 'regex')
      c.re = new RegExp(rule.match.pattern, (rule.match.flags ?? '').replace('g', ''))
    compiled.set(rule, c)
  }
  return c
}

function matchRule(rule: Rule, p: Prompt): RegExpExecArray | null | false {
  const c = patterns(rule)
  if (c.model && !c.model.test(p.model)) return false
  const target = rule.match.target ?? 'last'
  const hay = target === 'all' ? p.all : target === 'system' ? p.system : p.last
  switch (rule.match.kind) {
    case 'always':
      return null
    case 'contains': {
      if (!rule.match.pattern) return false
      const ci = (rule.match.flags ?? '').includes('i')
      return (ci ? hay.toLowerCase() : hay).includes(
        ci ? rule.match.pattern.toLowerCase() : rule.match.pattern,
      )
        ? null
        : false
    }
    case 'regex': {
      if (!c.re) return false
      // A shared RegExp with the sticky flag keeps its position; every match starts over.
      c.re.lastIndex = 0
      return c.re.exec(hay) ?? false
    }
  }
}

function renderResponse(
  spec: ResponseSpec,
  ctx: Ctx,
): { text: string; toolCalls: ToolCall[]; error?: string } {
  switch (spec.kind) {
    case 'template':
      return { text: renderTemplate(spec.text, ctx), toolCalls: [] }
    case 'echo':
      return { text: ctx.prompt.last, toolCalls: [] }
    case 'lorem': {
      const min = spec.minWords ?? 20
      const n = randInt(ctx.rng, min, Math.max(min, spec.maxWords ?? min))
      return { text: lorem(ctx.rng, n, spec.lang ?? 'auto', ctx.prompt.last), toolCalls: [] }
    }
    case 'json':
      return { text: renderTemplate(spec.text, { ...ctx, json: true }), toolCalls: [] }
    case 'tool': {
      const name = renderTemplate(spec.toolName ?? '', ctx).trim() || 'tool'
      const raw = renderTemplate(spec.text || '{}', { ...ctx, json: true })
      let args: unknown
      try {
        args = raw.trim() ? JSON.parse(raw) : {}
      } catch {
        return {
          text: '',
          toolCalls: [{ name, arguments: {} }],
          error: `tool arguments are not valid JSON: ${raw}`,
        }
      }
      return { text: '', toolCalls: [{ name, arguments: args }] }
    }
  }
}

/** Fake values for a JSON schema, used when the client sets `format` but the rule returns text. */
export function fakeFromSchema(schema: unknown, rng: Rng, text: string, depth = 0): unknown {
  if (typeof schema !== 'object' || schema === null || depth > 6) return text
  const s = schema as Record<string, unknown>
  if (Array.isArray(s.enum) && s.enum.length) return pick(rng, s.enum)
  if ('const' in s) return s.const
  const type = Array.isArray(s.type) ? s.type[0] : s.type
  switch (type) {
    case 'object': {
      const props = (s.properties ?? {}) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      let first = true
      for (const [k, v] of Object.entries(props)) {
        // The first string property carries the reply text, so the rule still shows.
        const isString = (v as { type?: unknown })?.type === 'string'
        out[k] = isString && first ? text : fakeFromSchema(v, rng, text, depth + 1)
        if (isString) first = false
      }
      return out
    }
    case 'array': {
      const n = randInt(rng, 1, 3)
      return Array.from({ length: n }, () => fakeFromSchema(s.items, rng, text, depth + 1))
    }
    case 'integer':
      return randInt(rng, 0, 100)
    case 'number':
      return Math.round(rng() * 10000) / 100
    case 'boolean':
      return rng() < 0.5
    case 'null':
      return null
    default:
      return lorem(rng, randInt(rng, 2, 5), 'en')
  }
}

function applyFormat(text: string, format: unknown, rng: Rng): string {
  if (format === undefined || format === null || format === '') return text
  const trimmed = text.trim()
  if (format === 'json') {
    try {
      JSON.parse(trimmed)
      return text
    } catch {
      return JSON.stringify({ response: text })
    }
  }
  if (typeof format === 'object') {
    try {
      JSON.parse(trimmed)
      return text
    } catch {
      return JSON.stringify(fakeFromSchema(format, rng, text), null, 2)
    }
  }
  return text
}

export interface EngineOptions {
  /** Fixed seed from config; null = random every time. */
  seed: number | null
}

export class Engine {
  private rules: RulesFile
  private opts: EngineOptions
  private counter = 0

  constructor(rules: RulesFile, opts: EngineOptions) {
    this.rules = rules
    this.opts = opts
  }

  setRules(rules: RulesFile): void {
    this.rules = rules
  }

  getRules(): RulesFile {
    return this.rules
  }

  setOptions(opts: EngineOptions): void {
    this.opts = opts
  }

  private rngFor(p: Prompt): Rng {
    const seed = p.seed ?? this.opts.seed
    if (seed === null || seed === undefined) return Math.random
    return createRng(hashString(`${p.model}\n${p.system}\n${p.all}`, seed >>> 0))
  }

  plan(p: Prompt): Plan & { error?: string } {
    const rng = this.rngFor(p)
    const requestNo = ++this.counter
    const base = { rng, prompt: p, json: false, requestNo }

    let match: MatchInfo = { source: 'fallback', name: 'Fallback' }
    let spec: ResponseSpec = this.rules.fallback
    let rule: Rule | undefined
    let groups: RegExpExecArray | null = null

    for (const r of this.rules.rules) {
      if (!r.enabled) continue
      if (p.afterTool && r.response.kind === 'tool') continue
      const m = matchRule(r, p)
      if (m === false) continue
      rule = r
      groups = m
      spec = r.response
      match = { source: 'rule', id: r.id, name: r.name }
      break
    }
    if (!rule) {
      const hay = p.last.toLowerCase()
      const kw = this.rules.keywords.find(
        (k) => k.enabled && k.keyword && hay.includes(k.keyword.toLowerCase()),
      )
      if (kw) {
        spec = { kind: 'template', text: kw.reply }
        match = { source: 'keyword', id: kw.id, name: `"${kw.keyword}"` }
      }
    }

    const ctx: Ctx = { ...base, groups }
    const out = renderResponse(spec, ctx)
    const text = out.toolCalls.length ? out.text : applyFormat(out.text, p.format, rng)
    let thinking = ''
    if (p.think) {
      thinking = spec.think
        ? renderTemplate(spec.think, ctx)
        : hasJapanese(p.last)
          ? `ユーザーの意図を考えます。${lorem(rng, randInt(rng, 8, 14), 'ja')}`
          : `Let me think about what the user wants. ${lorem(rng, randInt(rng, 15, 30), 'en')}`
    }
    const plan: Plan & { error?: string } = { match, text, thinking, toolCalls: out.toolCalls }
    if (rule?.ttftMs !== undefined) plan.ttftMs = rule.ttftMs
    if (rule?.tps !== undefined) plan.tps = rule.tps
    if (rule?.fault) plan.fault = rule.fault
    if (rule?.fault === 'error500' && rule.status) {
      const n = Number.parseInt(renderTemplate(rule.status, ctx), 10)
      if (n >= 400 && n <= 599) plan.errorStatus = n
    }
    if (out.error) plan.error = out.error
    return plan
  }

  /** The rule tester: what a prompt would get, without touching the server. */
  test(input: { prompt: string; system?: string; model?: string; think?: boolean }): TestResult {
    try {
      const plan = this.plan({
        model: input.model || 'llama3.2:3b',
        last: input.prompt,
        all: [input.system, input.prompt].filter(Boolean).join('\n'),
        system: input.system ?? '',
        think: input.think ?? false,
      })
      const r: TestResult = {
        match: plan.match,
        text: plan.text,
        thinking: plan.thinking,
        toolCalls: plan.toolCalls,
      }
      if (plan.fault)
        r.error = `fault: ${plan.fault}${plan.errorStatus ? ` (${plan.errorStatus})` : ''}`
      if (plan.error) r.error = plan.error
      return r
    } catch (e) {
      return {
        match: { source: 'fallback', name: '(error)' },
        text: '',
        thinking: '',
        toolCalls: [],
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }
}
