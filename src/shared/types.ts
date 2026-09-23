/**
 * Types shared by the mock server core, the Electron main process and the UI.
 * Type-only: nothing here may carry runtime code, because the renderer and the
 * type-stripped CLI both import it.
 */

export type FaultMode = 'error500' | 'disconnect' | 'hang' | 'malformed'
export type FaultSetting = FaultMode | 'random'

/**
 * mock: every reply is made up. proxy: everything goes to a real Ollama and is recorded on the way.
 * mixed: prompts a rule or keyword matches are made up, the rest go to the real Ollama.
 */
export type ServerMode = 'mock' | 'proxy' | 'mixed'

/** Everything the server needs to run. Loaded from .env (see core/config.ts). */
export interface MockConfig {
  host: string
  port: number
  /** Requests generated at the same time, like OLLAMA_NUM_PARALLEL. */
  numParallel: number
  /** Requests allowed to wait for a slot before 503, like OLLAMA_MAX_QUEUE. */
  maxQueue: number
  /** Time to first token, in ms. */
  ttftMs: number
  /** Tokens per second while streaming. 0 = as fast as possible. */
  tps: number
  /** Random spread applied to every delay, 0..1. */
  jitter: number
  /** Extra delay the first time a model is used (or after keep_alive expired). */
  loadMs: number
  /** Default keep_alive in seconds. */
  keepAliveSec: number
  /** Fixed seed: the same prompt always gets the same reply. null = random. */
  seed: number | null
  /** Reported by /api/version. */
  version: string
  /** Installed models, reported by /api/tags. */
  models: string[]
  /** Reject models that are not in the list with 404, as real Ollama does. */
  strictModels: boolean
  embedDim: number
  /** Access-Control-Allow-Origin value. Empty disables CORS headers. */
  cors: string
  /** Probability 0..1 that a request gets a fault injected. */
  faultRate: number
  faultMode: FaultSetting
  /** How long a simulated /api/pull takes, in ms. */
  pullMs: number
  /** Path of the rules file. Relative paths resolve against the .env directory. */
  rulesPath: string
  mode: ServerMode
  /** Base URL of the real Ollama used by the proxy and mixed modes. */
  upstream: string
  /** Save every reply the real Ollama gives (proxy and mixed modes) to the recordings file. */
  record: boolean
  /** Answer recorded prompts with the recorded reply (mock and mixed modes). */
  replay: boolean
  /** Path of the recordings file. Relative paths resolve against the .env directory. */
  recordingsPath: string
}

export type MatchKind = 'regex' | 'contains' | 'always'
export type MatchTarget = 'last' | 'all' | 'system'
export type ResponseKind = 'template' | 'lorem' | 'json' | 'echo' | 'tool'
export type LoremLang = 'auto' | 'en' | 'ja'

export interface ResponseSpec {
  kind: ResponseKind
  /** template: reply text. json: JSON template. tool: arguments JSON template. */
  text: string
  /** tool: function name to call. */
  toolName?: string
  /** lorem: language and length in words. */
  lang?: LoremLang
  minWords?: number
  maxWords?: number
  /** Reasoning text sent when the client asks for thinking. Empty = generated. */
  think?: string
}

export interface Rule {
  id: string
  name: string
  enabled: boolean
  match: {
    kind: MatchKind
    pattern: string
    /** Regex flags, e.g. "i". */
    flags?: string
    target?: MatchTarget
    /** Optional regex the model name must match. */
    model?: string
  }
  response: ResponseSpec
  /** Per-rule speed overrides. */
  ttftMs?: number
  tps?: number
  /** Always fail requests that match this rule. */
  fault?: FaultMode
}

/** The quick table: a reply for any prompt containing the keyword. */
export interface KeywordEntry {
  id: string
  enabled: boolean
  keyword: string
  reply: string
}

export interface RulesFile {
  version: 1
  rules: Rule[]
  keywords: KeywordEntry[]
  fallback: ResponseSpec
}

export type Api =
  | 'generate'
  | 'chat'
  | 'embed'
  | 'openai-chat'
  | 'openai-completion'
  | 'openai-embed'
  | 'pull'

export type RequestState =
  | 'queued'
  | 'loading'
  | 'waiting'
  | 'thinking'
  | 'streaming'
  | 'done'
  | 'error'
  | 'aborted'

export interface MatchInfo {
  /** 'upstream': answered by the real Ollama. 'recording': a recorded reply played back. */
  source: 'rule' | 'keyword' | 'fallback' | 'upstream' | 'recording'
  id?: string
  name: string
}

/**
 * One reply of the real Ollama, kept so the mock can play it back. The input is
 * kept as it was; matching ignores case, spaces, punctuation and symbols.
 */
export interface Recording {
  id: string
  model: string
  api: Api
  /** The last user message (or generate prompt), for display. */
  prompt: string
  /** System prompt and every message, joined: what is matched. */
  conversation: string
  /** The reply as it streamed: content chunks, thinking chunks, tool calls. */
  chunks: string[]
  thinking: string[]
  toolCalls: { name: string; arguments: unknown }[]
  /** Measured time to first token and generation speed, for playback. */
  ttftMs: number
  tps: number
  recordedAt: string
  /** The Ollama it came from. */
  source: string
}

export interface RecordingsFile {
  version: 1
  recordings: Recording[]
}

/** What a real Ollama said it spent on a reply (its *_duration and *_count fields), in ms. */
export interface ReportedTimings {
  loadMs: number
  promptMs: number
  evalMs: number
  totalMs: number
  promptTokens: number
  evalTokens: number
}

/** One request as seen by the dashboard and the inspector. */
export interface RequestRecord {
  id: number
  api: Api
  method: string
  path: string
  model: string
  stream: boolean
  state: RequestState
  status: number
  slot: number | null
  match: MatchInfo | null
  fault: FaultMode | null
  /** Epoch ms of each phase; 0 = not reached. */
  t: { received: number; started: number; firstToken: number; ended: number }
  loadMs: number
  promptTokens: number
  tokens: number
  /** Planned reply length in tokens, for progress bars. */
  plannedTokens: number
  requestBody: unknown
  responseText: string
  thinkingText: string
  error: string
  /** Proxied replies only: the timings the real Ollama reported. */
  reported: ReportedTimings | null
}

export interface SlotInfo {
  index: number
  requestId: number | null
}

export interface LoadedModel {
  name: string
  expiresAt: number
}

export interface Totals {
  requests: number
  completed: number
  errors: number
  aborted: number
  rejected: number
  tokens: number
}

/** The real Ollama behind the proxy, as last polled. */
export interface UpstreamInfo {
  url: string
  ok: boolean
  error: string
  /**
   * What answered: 'ollama' - Ollama's own API (/api/...), with its version and loaded
   * models; 'openai' - only the OpenAI-compatible /v1/models (LM Studio, llama.cpp, vLLM,
   * or a proxy that exposes only /v1). '' before the first answer.
   */
  api: 'ollama' | 'openai' | ''
  version: string
  models: string[]
  loaded: { name: string; expiresAt: number; sizeVram: number }[]
  checkedAt: number
}

/** Pushed to the UI several times a second while the server runs. */
export interface Snapshot {
  now: number
  startedAt: number
  url: string
  config: MockConfig
  slots: SlotInfo[]
  queue: number[]
  /** Queued and in-flight requests. */
  active: RequestRecord[]
  /** Requests that finished since the previous snapshot. */
  finished: RequestRecord[]
  totals: Totals
  /** Tokens emitted per second, oldest first, one entry per second. */
  tpsSeries: number[]
  /** Requests started per second. */
  rpsSeries: number[]
  /** Busy slots, sampled once per second. */
  busySeries: number[]
  queueSeries: number[]
  loaded: LoadedModel[]
  models: string[]
  pendingFaults: FaultMode[]
  /** null in mock mode. */
  upstream: UpstreamInfo | null
}

export interface TestInput {
  prompt: string
  system?: string
  model?: string
}

export interface TestResult {
  match: MatchInfo
  text: string
  thinking: string
  toolCalls: { name: string; arguments: unknown }[]
  error?: string
}

/** Speed presets offered by the CLI and the UI. */
export interface Preset {
  id: string
  label: string
  description: string
  values: Pick<MockConfig, 'ttftMs' | 'tps' | 'jitter' | 'loadMs'> & { seed?: number | null }
}
