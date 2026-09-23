import type { FaultMode, FaultSetting, MockConfig, Preset, ServerMode } from '../shared/types.ts'

/** Here, not in rules.ts: the UI imports this file, and rules.ts brings every built-in rule. */
export const FAULT_MODES: readonly FaultMode[] = ['error500', 'disconnect', 'hang', 'malformed']

export const DEFAULT_MODELS = [
  'llama3.2:3b',
  'qwen3:8b',
  'gemma3:4b',
  'gpt-oss:20b',
  'nomic-embed-text:latest',
]

export function defaultConfig(): MockConfig {
  return {
    host: '127.0.0.1',
    port: 11434,
    numParallel: 4,
    maxQueue: 512,
    ttftMs: 350,
    tps: 30,
    jitter: 0.2,
    loadMs: 1200,
    keepAliveSec: 300,
    seed: null,
    version: '0.12.0',
    models: [...DEFAULT_MODELS],
    strictModels: false,
    embedDim: 768,
    cors: '*',
    faultRate: 0,
    faultMode: 'random',
    pullMs: 4000,
    rulesPath: 'rules.json',
    mode: 'mock',
    upstream: 'http://127.0.0.1:11434/v1',
    record: false,
    replay: false,
    recordingsPath: 'recordings.json',
  }
}

export const SERVER_MODES: readonly ServerMode[] = ['mock', 'proxy', 'mixed']

/**
 * The server behind an upstream URL. The upstream is given the way OpenAI-style
 * clients take it, ending in /v1; Ollama's own API (/api/...) and every forwarded
 * path hang off the server root. A URL without /v1 is its own root.
 */
export const upstreamRoot = (upstream: string): string => upstream.replace(/\/v1\/?$/, '')

/** "localhost:11434" or "http://host:port/" -> "http://host:port"; '' when it is not an http(s) URL. */
export function normalizeUpstream(v: string): string {
  const s = v.trim()
  if (!s) return ''
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    if (/["'\s]/.test(s)) return ''
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return ''
  }
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'instant',
    label: 'Instant',
    description: 'No delays at all. For unit tests and CI.',
    values: { ttftMs: 0, tps: 0, jitter: 0, loadMs: 0 },
  },
  {
    id: 'fast',
    label: 'Fast GPU',
    description: 'A big GPU: quick first token, 120 tok/s.',
    values: { ttftMs: 120, tps: 120, jitter: 0.15, loadMs: 600 },
  },
  {
    id: 'realistic',
    label: 'Realistic',
    description: 'A typical desktop GPU running an 8B model.',
    values: { ttftMs: 350, tps: 30, jitter: 0.2, loadMs: 1200 },
  },
  {
    id: 'slow',
    label: 'Slow CPU',
    description: 'CPU-only inference: long waits, 6 tok/s. For testing spinners and timeouts.',
    values: { ttftMs: 2500, tps: 6, jitter: 0.3, loadMs: 6000 },
  },
  {
    id: 'demo',
    label: 'Demo',
    description: 'Smooth, readable streaming with a fixed seed. For videos and screenshots.',
    values: { ttftMs: 500, tps: 25, jitter: 0, loadMs: 0, seed: 42 },
  },
]

/** One .env key per config field. The OLLAMA_* names are accepted as fallbacks. */
export const ENV_KEYS: { [K in keyof MockConfig]: { key: string; doc: string } } = {
  host: { key: 'MOCKOLLA_HOST', doc: 'Address to listen on. 0.0.0.0 to accept other machines.' },
  port: { key: 'MOCKOLLA_PORT', doc: 'Port. 11434 is the real Ollama port.' },
  numParallel: { key: 'MOCKOLLA_NUM_PARALLEL', doc: 'Requests generated at the same time.' },
  maxQueue: { key: 'MOCKOLLA_MAX_QUEUE', doc: 'Requests that may wait for a slot; more get 503.' },
  ttftMs: { key: 'MOCKOLLA_TTFT_MS', doc: 'Time to first token (ms).' },
  tps: { key: 'MOCKOLLA_TPS', doc: 'Tokens per second. 0 = no delay.' },
  jitter: { key: 'MOCKOLLA_JITTER', doc: 'Random spread of every delay, 0..1.' },
  loadMs: { key: 'MOCKOLLA_LOAD_MS', doc: 'Model load time on first use (ms).' },
  keepAliveSec: { key: 'MOCKOLLA_KEEP_ALIVE', doc: 'Seconds a model stays loaded.' },
  seed: { key: 'MOCKOLLA_SEED', doc: 'Fixed seed: same prompt, same reply. Empty = random.' },
  version: { key: 'MOCKOLLA_VERSION', doc: 'Version reported by /api/version.' },
  models: { key: 'MOCKOLLA_MODELS', doc: 'Comma-separated model list for /api/tags.' },
  strictModels: { key: 'MOCKOLLA_STRICT_MODELS', doc: 'true = unknown models get 404.' },
  embedDim: { key: 'MOCKOLLA_EMBED_DIM', doc: 'Embedding vector length.' },
  cors: { key: 'MOCKOLLA_CORS', doc: 'Access-Control-Allow-Origin. Empty disables CORS.' },
  faultRate: { key: 'MOCKOLLA_FAULT_RATE', doc: 'Chance 0..1 of injecting a fault.' },
  faultMode: {
    key: 'MOCKOLLA_FAULT_MODE',
    doc: 'random | error500 | disconnect | hang | malformed',
  },
  pullMs: { key: 'MOCKOLLA_PULL_MS', doc: 'Duration of a simulated /api/pull (ms).' },
  rulesPath: { key: 'MOCKOLLA_RULES', doc: 'Reply rules file, relative to this .env.' },
  mode: {
    key: 'MOCKOLLA_MODE',
    doc: 'mock = made-up replies | proxy = forward to a real Ollama | mixed = rules first, then Ollama',
  },
  upstream: {
    key: 'MOCKOLLA_UPSTREAM',
    doc: 'The real Ollama for proxy and mixed modes, as OpenAI clients take it (ending in /v1).',
  },
  record: {
    key: 'MOCKOLLA_RECORD',
    doc: "true = save the real Ollama's replies (proxy and mixed modes) to the recordings file.",
  },
  replay: {
    key: 'MOCKOLLA_REPLAY',
    doc: 'true = answer recorded prompts with the recorded reply (mock and mixed modes).',
  },
  recordingsPath: {
    key: 'MOCKOLLA_RECORDINGS',
    doc: 'Recorded replies, relative to this .env.',
  },
}

// --- .env parsing -----------------------------------------------------------

/** Parses dotenv syntax: KEY=value, quotes, `export`, # comments. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1] as string
    let value = (m[2] as string).trim()
    const quoted = /^(["'])((?:\\.|(?!\1).)*)\1\s*(?:#.*)?$/.exec(value)
    if (quoted) {
      value = quoted[1] === '"' ? unquote(`"${quoted[2]}"`) : (quoted[2] as string)
    } else {
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    out[key] = value
  }
  return out
}

/** A double-quoted value: JSON string syntax (what serializeEnv writes), else the text as it is. */
function unquote(quoted: string): string {
  try {
    const v: unknown = JSON.parse(quoted)
    if (typeof v === 'string') return v
  } catch {
    // Hand-written, e.g. "C:\path": not JSON, so its backslashes are literal.
  }
  return quoted.slice(1, -1)
}

const bool = (v: string): boolean => /^(1|true|yes|on)$/i.test(v.trim())
const clampNum = (v: string, min: number, max: number, int: boolean): number | undefined => {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n)) return undefined
  const c = Math.min(max, Math.max(min, n))
  return int ? Math.round(c) : c
}

/** Splits OLLAMA_HOST-style values: "0.0.0.0", ":11435", "http://host:port". */
function splitHost(v: string): { host?: string; port?: number } {
  const s = v.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const m = /^(.*?)(?::(\d+))?$/.exec(s)
  const out: { host?: string; port?: number } = {}
  if (m?.[1]) out.host = m[1]
  if (m?.[2]) out.port = Number(m[2])
  return out
}

/** Applies string values (from .env or process.env) onto a config. Unknown or invalid values are ignored. */
export function applyEnv(base: MockConfig, env: Record<string, string | undefined>): MockConfig {
  const c: MockConfig = { ...base, models: [...base.models] }
  const get = (k: keyof MockConfig): string | undefined => env[ENV_KEYS[k].key]

  const ollamaHost = env.OLLAMA_HOST
  if (ollamaHost) Object.assign(c, splitHost(ollamaHost))
  const ints: [keyof MockConfig, string | undefined, number, number][] = [
    ['port', get('port'), 1, 65535],
    ['numParallel', get('numParallel') ?? env.OLLAMA_NUM_PARALLEL, 1, 64],
    ['maxQueue', get('maxQueue') ?? env.OLLAMA_MAX_QUEUE, 0, 100000],
    ['ttftMs', get('ttftMs'), 0, 600000],
    ['loadMs', get('loadMs'), 0, 600000],
    ['keepAliveSec', get('keepAliveSec'), 0, 86400 * 365],
    ['embedDim', get('embedDim'), 1, 8192],
    ['pullMs', get('pullMs'), 0, 600000],
  ]
  for (const [k, v, min, max] of ints) {
    if (v === undefined) continue
    const n = clampNum(v, min, max, true)
    if (n !== undefined) (c as unknown as Record<string, unknown>)[k] = n
  }
  const tps = get('tps')
  if (tps !== undefined) c.tps = clampNum(tps, 0, 100000, false) ?? c.tps
  const jitter = get('jitter')
  if (jitter !== undefined) c.jitter = clampNum(jitter, 0, 1, false) ?? c.jitter
  const rate = get('faultRate')
  if (rate !== undefined) c.faultRate = clampNum(rate, 0, 1, false) ?? c.faultRate

  const host = get('host')
  if (host) c.host = host
  const seed = get('seed')
  if (seed !== undefined)
    c.seed = seed.trim() === '' ? null : (clampNum(seed, 0, 2 ** 32 - 1, true) ?? null)
  const version = get('version')
  if (version) c.version = version
  const models = get('models')
  if (models !== undefined) {
    const list = models
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length) c.models = list
  }
  const strict = get('strictModels')
  if (strict !== undefined) c.strictModels = bool(strict)
  const cors = get('cors')
  if (cors !== undefined && (cors === '' || cors === '*' || /^https?:\/\/[^\s,/"]+$/.test(cors)))
    c.cors = cors
  const mode = get('faultMode')
  if (mode && (mode === 'random' || FAULT_MODES.includes(mode as never)))
    c.faultMode = mode as FaultSetting
  const rules = get('rulesPath')
  if (rules) c.rulesPath = rules
  const serverMode = get('mode')
  if (serverMode && SERVER_MODES.includes(serverMode as ServerMode))
    c.mode = serverMode as ServerMode
  const upstream = get('upstream')
  if (upstream) c.upstream = normalizeUpstream(upstream) || c.upstream
  const record = get('record')
  if (record !== undefined) c.record = bool(record)
  const replay = get('replay')
  if (replay !== undefined) c.replay = bool(replay)
  const recordings = get('recordingsPath')
  if (recordings) c.recordingsPath = recordings
  return c
}

/** Validates a partial config from the UI or the control API. */
export function patchConfig(
  base: MockConfig,
  patch: Partial<Record<keyof MockConfig, unknown>>,
): MockConfig {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(patch)) {
    const spec = ENV_KEYS[k as keyof MockConfig]
    if (!spec || v === undefined) continue
    env[spec.key] = Array.isArray(v) ? v.join(',') : v === null ? '' : String(v)
  }
  return applyEnv(base, env)
}

export function configToEnv(c: MockConfig): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, spec] of Object.entries(ENV_KEYS)) {
    const v = c[k as keyof MockConfig]
    out[spec.key] = Array.isArray(v) ? v.join(',') : v === null ? '' : String(v)
  }
  return out
}

const quote = (v: string): string => (/[\s#"'=]/.test(v) ? JSON.stringify(v) : v)

/**
 * Writes a commented .env. Keys this app does not manage are kept at the end,
 * so hand-added variables survive a save from the UI.
 */
export function serializeEnv(c: MockConfig, previous = ''): string {
  const values = configToEnv(c)
  const lines = [
    '# elecmockolla settings. Edited by the app (Settings) or by hand.',
    '# CLI: `npm run serve` reads this file. Environment variables override it.',
    '',
  ]
  for (const spec of Object.values(ENV_KEYS)) {
    lines.push(`# ${spec.doc}`)
    lines.push(`${spec.key}=${quote(values[spec.key] ?? '')}`)
  }
  const managed = new Set(Object.values(ENV_KEYS).map((s) => s.key))
  const extra = Object.entries(parseEnv(previous)).filter(([k]) => !managed.has(k))
  if (extra.length) {
    lines.push('', '# Other variables')
    for (const [k, v] of extra) lines.push(`${k}=${quote(v)}`)
  }
  return `${lines.join('\n')}\n`
}

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id)

export function applyPreset(c: MockConfig, p: Preset): MockConfig {
  const { seed, ...rest } = p.values
  return { ...c, ...rest, ...(seed !== undefined ? { seed } : {}) }
}
