import { createHash } from 'node:crypto'
import type { LoadedModel } from '../shared/types.ts'
import { createRng, hashString } from './random.ts'

/** "llama3.2" and "llama3.2:latest" are the same model, as in Ollama. */
export const normalizeModel = (name: string): string => {
  const n = name.trim()
  return n.includes(':') ? n : `${n}:latest`
}

export const sameModel = (a: string, b: string): boolean => normalizeModel(a) === normalizeModel(b)

export interface ModelDetails {
  parent_model: string
  format: string
  family: string
  families: string[]
  parameter_size: string
  quantization_level: string
}

export interface ModelInfo {
  name: string
  digest: string
  size: number
  details: ModelDetails
  capabilities: string[]
  contextLength: number
  modifiedAt: string
}

const FAMILIES: [RegExp, string][] = [
  [/embed|bge|minilm/i, 'bert'],
  [/gpt-oss/i, 'gptoss'],
  [/llama/i, 'llama'],
  [/qwen/i, 'qwen3'],
  [/gemma/i, 'gemma3'],
  [/mistral|mixtral/i, 'mistral'],
  [/phi/i, 'phi3'],
  [/deepseek/i, 'deepseek2'],
]

/** Everything /api/tags and /api/show report, derived from the name so it is stable. */
export function describeModel(name: string): ModelInfo {
  const full = normalizeModel(name)
  const [base = full, tag = 'latest'] = full.split(':')
  const family = FAMILIES.find(([re]) => re.test(base))?.[1] ?? 'llama'
  const embed = family === 'bert'
  const sizeMatch = /(\d+(?:\.\d+)?)([bm])/i.exec(tag)
  let params = sizeMatch
    ? Number(sizeMatch[1]) * (sizeMatch[2]?.toLowerCase() === 'm' ? 1e6 : 1e9)
    : 0
  if (!params) params = embed ? 137e6 : 8e9
  const paramLabel =
    params >= 1e9 ? `${Number((params / 1e9).toFixed(1))}B` : `${Math.round(params / 1e6)}M`
  const caps = embed ? ['embedding'] : ['completion', 'tools']
  if (/qwen3|gpt-oss|r1|think|magistral/i.test(full)) caps.push('thinking')
  if (/gemma3|llava|vision|vl/i.test(full)) caps.push('vision')
  const digest = createHash('sha256').update(`elecmockolla:${full}`).digest('hex')
  // Q4_K_M weighs a little over half a byte per parameter.
  const size = Math.round(params * (embed ? 2 : 0.6))
  return {
    name: full,
    digest,
    size,
    details: {
      parent_model: '',
      format: 'gguf',
      family,
      families: [family],
      parameter_size: paramLabel,
      quantization_level: embed ? 'F16' : 'Q4_K_M',
    },
    capabilities: caps,
    contextLength: embed ? 2048 : 131072,
    // A fixed date per model keeps screenshots and snapshots stable.
    modifiedAt: new Date(Date.UTC(2026, 0, 1 + (hashString(full) % 200))).toISOString(),
  }
}

/** Parses keep_alive: seconds, "5m", "1h30m", -1 (forever), 0 (unload now). */
export function parseKeepAlive(v: unknown, fallbackSec: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 0 ? Number.POSITIVE_INFINITY : v
  if (typeof v !== 'string' || !v.trim()) return fallbackSec
  const s = v.trim()
  if (/^-/.test(s)) return Number.POSITIVE_INFINITY
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  let total = 0
  let matched = false
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true
    const n = Number(m[1])
    total += m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : m[2] === 'ms' ? n / 1000 : n
  }
  return matched ? total : fallbackSec
}

/** Which models are "in memory": the first request to a cold model pays the load time. */
export class LoadedModels {
  private map = new Map<string, number>()

  /** Returns true when the model had to be loaded. */
  touch(name: string, keepAliveSec: number, now = Date.now()): boolean {
    const key = normalizeModel(name)
    const exp = this.map.get(key)
    const cold = exp === undefined || exp <= now
    this.map.set(key, now + keepAliveSec * 1000)
    return cold
  }

  /** Sets the expiry without loading, e.g. keep_alive: 0 after a request. */
  expire(name: string, keepAliveSec: number, now = Date.now()): void {
    const key = normalizeModel(name)
    if (keepAliveSec <= 0) this.map.delete(key)
    else this.map.set(key, now + keepAliveSec * 1000)
  }

  list(now = Date.now()): LoadedModel[] {
    const out: LoadedModel[] = []
    for (const [name, exp] of this.map) {
      if (exp <= now) this.map.delete(name)
      else out.push({ name, expiresAt: exp })
    }
    return out
  }

  clear(): void {
    this.map.clear()
  }
}

const WORD = /[a-z0-9]+|[぀-ヿ㐀-鿿]/g

/**
 * Deterministic embeddings with a real notion of similarity: feature hashing of
 * words and CJK bigrams, plus a little seeded noise, L2-normalised. Texts that
 * share words get a high cosine similarity, so RAG code can be tested.
 */
export function embed(text: string, dim: number, model: string): number[] {
  const v = new Array<number>(dim).fill(0)
  const lower = text.toLowerCase()
  const units = lower.match(WORD) ?? []
  const feats: string[] = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i] as string
    feats.push(u)
    const next = units[i + 1]
    // CJK has no spaces: bigrams of neighbouring characters carry the meaning.
    if (u.length === 1 && next?.length === 1) feats.push(u + next)
  }
  for (const f of feats) {
    const h = hashString(f)
    const idx = h % dim
    v[idx] = (v[idx] ?? 0) + ((h >>> 16) & 1 ? 1 : -1)
  }
  const rng = createRng(hashString(`${model}\n${text}`))
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) + (rng() - 0.5) * 0.05
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => Math.round((x / norm) * 1e7) / 1e7)
}
