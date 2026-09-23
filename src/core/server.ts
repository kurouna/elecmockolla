import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  Api,
  FaultMode,
  MockConfig,
  Recording,
  RequestRecord,
  RulesFile,
  Snapshot,
  TestInput,
  TestResult,
} from '../shared/types.ts'
import { patchConfig } from './config.ts'
import { Engine, type Plan, type Prompt } from './engine.ts'
import {
  describeModel,
  embed,
  LoadedModels,
  normalizeModel,
  parseKeepAlive,
  sameModel,
} from './models.ts'
import { Monitor } from './monitor.ts'
import { forward, HOP_HEADER, UpstreamError, UpstreamWatch } from './proxy.ts'
import { jittered } from './random.ts'
import { RecordingStore, recordingId } from './recordings.ts'
import { FAULT_MODES, normalizeRules, RulesError } from './rules.ts'
import { AbortedError, QueueFullError, Scheduler } from './scheduler.ts'
import { countTokens, tokenize } from './text.ts'
import {
  type FinishStats,
  OllamaChatWriter,
  OllamaGenerateWriter,
  OpenAIChatWriter,
  OpenAICompletionWriter,
  ollamaError,
  openaiError,
  sendJson,
  type Writer,
} from './writers.ts'

type Planned = ReturnType<Engine['plan']>

const MAX_BODY = 64 * 1024 * 1024
/** A "hang" fault gives up after this long, so a forgotten client cannot hold a slot forever. */
const HANG_LIMIT_MS = 10 * 60 * 1000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** A signal that aborts when the client goes away before the reply is complete. */
function abortOnClose(res: ServerResponse): AbortSignal {
  const ac = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) ac.abort()
  })
  return ac.signal
}

/** Resolves true after `ms`, or false as soon as the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  if (ms <= 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseJson(raw: Buffer): unknown {
  const text = raw.toString('utf8')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new HttpError(400, `invalid JSON: ${e instanceof Error ? e.message : e}`)
  }
}

const readBody = async (req: IncomingMessage): Promise<unknown> => parseJson(await readRaw(req))

/** The endpoints whose traffic is recorded in proxy and mixed modes; the rest pass straight through. */
const PROXY_APIS: Record<string, Api> = {
  'POST /api/generate': 'generate',
  'POST /api/chat': 'chat',
  'POST /api/embed': 'embed',
  'POST /api/embeddings': 'embed',
  'POST /v1/chat/completions': 'openai-chat',
  'POST /v1/completions': 'openai-completion',
  'POST /v1/embeddings': 'openai-embed',
}

/** Message content may be a string or (OpenAI) an array of parts. */
function contentText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c))
    return c
      .map((p) => (isObj(p) && typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
  return ''
}

interface Parsed {
  prompt: Prompt
  stream: boolean
  numPredict: number
  keepAlive: unknown
  includeUsage: boolean
  /** Empty prompt: a load / unload request. */
  empty: boolean
}

function parseMessages(messages: unknown): {
  last: string
  all: string
  system: string
  count: number
} {
  const list = Array.isArray(messages) ? messages.filter(isObj) : []
  const system = list
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => contentText(m.content))
    .join('\n')
  const users = list.filter((m) => m.role === 'user')
  const last = contentText(users.at(-1)?.content)
  const all = list.map((m) => contentText(m.content)).join('\n')
  return { last, all, system, count: list.length }
}

function parseRequest(api: Api, body: Obj): Parsed {
  const model = str(body.model) || str(body.name)
  const options = isObj(body.options) ? body.options : {}
  const seedRaw = options.seed ?? body.seed
  const seed = typeof seedRaw === 'number' ? seedRaw : undefined
  let last = ''
  let all = ''
  let system = ''
  let empty = false
  if (api === 'generate' || api === 'openai-completion') {
    last = Array.isArray(body.prompt) ? body.prompt.map(String).join('\n') : str(body.prompt)
    system = str(body.system)
    all = [system, last].filter(Boolean).join('\n')
    empty = !last && api === 'generate'
  } else {
    const m = parseMessages(body.messages)
    ;({ last, all, system } = m)
    empty = m.count === 0 && api === 'chat'
  }
  const thinkRaw =
    body.think ??
    body.reasoning_effort ??
    (isObj(body.reasoning) ? body.reasoning.effort : undefined)
  const think =
    thinkRaw === true || (typeof thinkRaw === 'string' && thinkRaw !== 'none' && thinkRaw !== '')
  let format: unknown = body.format
  if (isObj(body.response_format)) {
    const rf = body.response_format
    if (rf.type === 'json_object') format = 'json'
    else if (rf.type === 'json_schema' && isObj(rf.json_schema))
      format = rf.json_schema.schema ?? 'json'
  }
  const predict = options.num_predict ?? body.max_tokens ?? body.max_completion_tokens
  const numPredict = typeof predict === 'number' && predict > 0 ? predict : Number.POSITIVE_INFINITY
  // Ollama streams by default; OpenAI does not.
  const openai = api.startsWith('openai')
  const stream = openai ? body.stream === true : body.stream !== false
  const includeUsage = isObj(body.stream_options) && body.stream_options.include_usage === true
  return {
    prompt: { model, last, all, system, seed, think, format },
    stream,
    numPredict,
    keepAlive: body.keep_alive,
    includeUsage,
    empty,
  }
}

export interface MockServerOptions {
  config: MockConfig
  rules: RulesFile
  recordings?: Recording[]
}

/** Tool calls as Ollama or OpenAI send them (OpenAI streams them in pieces), as name + arguments. */
function toolCallsOf(raw: unknown[]): { name: string; arguments: unknown }[] {
  const byIndex = new Map<number, { name: string; args: string; obj: unknown }>()
  raw.forEach((c, i) => {
    if (!isObj(c)) return
    const f = isObj(c.function) ? c.function : c
    const index = typeof c.index === 'number' ? c.index : i
    const cur = byIndex.get(index) ?? { name: '', args: '', obj: undefined }
    cur.name += str(f.name)
    if (typeof f.arguments === 'string') cur.args += f.arguments
    else if (f.arguments !== undefined) cur.obj = f.arguments
    byIndex.set(index, cur)
  })
  return [...byIndex.values()]
    .filter((c) => c.name)
    .map((c) => {
      let args: unknown = c.obj ?? {}
      if (c.args)
        try {
          args = JSON.parse(c.args)
        } catch {
          args = c.args
        }
      return { name: c.name, arguments: args }
    })
}

export class MockServer {
  config: MockConfig
  readonly engine: Engine
  readonly monitor = new Monitor()
  readonly loaded = new LoadedModels()
  /** The real Ollama, polled in proxy and mixed modes. */
  readonly upstream = new UpstreamWatch()
  readonly recordings: RecordingStore
  /** Called with each new recording (the host saves it to recordings.json). */
  onRecorded: ((r: Recording) => void) | null = null
  private scheduler: Scheduler
  private models: string[]
  private pendingFaults: FaultMode[] = []
  private server: http.Server | null = null
  private sockets = new Set<import('node:net').Socket>()
  private startedAt = 0
  private url = ''
  private sseClients = new Set<ServerResponse>()
  private sseTimer: NodeJS.Timeout | null = null

  constructor(opts: MockServerOptions) {
    this.config = opts.config
    this.engine = new Engine(opts.rules, { seed: opts.config.seed })
    this.scheduler = new Scheduler(opts.config.numParallel, opts.config.maxQueue)
    this.models = opts.config.models.map(normalizeModel)
    this.recordings = new RecordingStore(opts.recordings ?? [])
    this.monitor.sample = () => ({
      busy: this.scheduler.busyCount,
      queued: this.scheduler.queue().length,
    })
  }

  // --- lifecycle --------------------------------------------------------------

  start(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((e) => {
          if (!res.headersSent) ollamaError(res, 500, e instanceof Error ? e.message : String(e))
          else res.destroy()
        })
      })
      server.keepAliveTimeout = 5000
      server.on('connection', (s) => {
        this.sockets.add(s)
        s.on('close', () => this.sockets.delete(s))
      })
      server.once('error', reject)
      server.listen(this.config.port, this.config.host, () => {
        server.off('error', reject)
        const addr = server.address() as AddressInfo
        this.config = { ...this.config, port: addr.port }
        const host =
          this.config.host === '0.0.0.0' || this.config.host === '::'
            ? '127.0.0.1'
            : this.config.host
        this.url = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}`
        this.startedAt = Date.now()
        this.server = server
        this.upstream.configure(this.config.mode !== 'mock', this.config.upstream)
        resolve(this.url)
      })
    })
  }

  stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.upstream.stop()
    if (this.sseTimer) clearInterval(this.sseTimer)
    this.sseTimer = null
    for (const c of this.sseClients) c.end()
    this.sseClients.clear()
    if (!server) return Promise.resolve()
    return new Promise((resolve) => {
      server.close(() => resolve())
      for (const s of this.sockets) s.destroy()
    })
  }

  // --- runtime control (UI, control API) --------------------------------------

  /** Applies a new config. Host and port only take effect on restart. */
  setConfig(next: MockConfig): void {
    const prevModels = this.config.models.join(',')
    this.config = { ...next, host: this.config.host, port: this.config.port }
    this.engine.setOptions({ seed: next.seed })
    this.scheduler.resize(next.numParallel, next.maxQueue)
    if (next.models.join(',') !== prevModels) this.models = next.models.map(normalizeModel)
    if (this.server) this.upstream.configure(next.mode !== 'mock', next.upstream)
  }

  setRules(rules: RulesFile): void {
    this.engine.setRules(rules)
  }

  setRecordings(recordings: Recording[]): void {
    this.recordings.set(recordings)
  }

  /** The recorded reply for this prompt, when playback is on (mock and mixed modes). */
  private replayPlan(p: Prompt): Planned | undefined {
    if (!this.config.replay || this.config.mode === 'proxy') return undefined
    const r = this.recordings.find(p.model, p.all)
    if (!r) return undefined
    const thinking = p.think ? r.thinking : []
    const plan: Planned = {
      match: { source: 'recording', id: r.id, name: r.prompt.slice(0, 60) || r.id },
      text: r.chunks.join(''),
      thinking: thinking.join(''),
      toolCalls: r.toolCalls,
      chunks: [
        ...thinking.map((t) => ({ t, think: true })),
        ...r.chunks.map((t) => ({ t, think: false })),
      ],
    }
    if (r.ttftMs > 0) plan.ttftMs = r.ttftMs
    if (r.tps > 0) plan.tps = r.tps
    return plan
  }

  injectFault(mode: FaultMode, count = 1): void {
    for (let i = 0; i < Math.min(count, 1000); i++) this.pendingFaults.push(mode)
  }

  clearFaults(): void {
    this.pendingFaults = []
  }

  test(input: TestInput & { think?: boolean }): TestResult {
    return this.engine.test(input)
  }

  resetStats(): void {
    this.monitor.reset()
  }

  listModels(): string[] {
    return [...this.models]
  }

  /** The models clients can use: the real Ollama's in proxy mode, both lists in mixed mode. */
  private servedModels(): string[] {
    const up = this.upstream.info?.models ?? []
    if (this.config.mode === 'proxy') return [...up]
    if (this.config.mode === 'mixed') return [...new Set([...up, ...this.models])]
    return [...this.models]
  }

  /** `drain` hands finished records over (to the UI bridge); the HTTP API leaves them. */
  snapshot(drain = true): Snapshot {
    const now = Date.now()
    this.monitor.roll(now)
    const trim = (r: RequestRecord): RequestRecord => ({
      ...r,
      t: { ...r.t },
      responseText: r.responseText.length > 4000 ? r.responseText.slice(-4000) : r.responseText,
      thinkingText: r.thinkingText.length > 2000 ? r.thinkingText.slice(-2000) : r.thinkingText,
    })
    return {
      now,
      startedAt: this.startedAt,
      url: this.url,
      config: { ...this.config, models: [...this.models] },
      slots: this.scheduler.slots(),
      queue: this.scheduler.queue(),
      active: [...this.monitor.active.values()].map(trim),
      finished: drain ? this.monitor.takeFinished() : [],
      totals: { ...this.monitor.totals },
      tpsSeries: [...this.monitor.tps],
      rpsSeries: [...this.monitor.rps],
      busySeries: [...this.monitor.busy],
      queueSeries: [...this.monitor.queued],
      loaded: this.loaded.list(now),
      models: this.servedModels(),
      pendingFaults: [...this.pendingFaults],
      upstream: this.upstream.info ? { ...this.upstream.info } : null,
    }
  }

  // --- routing -----------------------------------------------------------------

  private cors(res: ServerResponse): void {
    if (!this.config.cors) return
    res.setHeader('Access-Control-Allow-Origin', this.config.cors)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.cors(res)
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const p = url.pathname.replace(/\/+$/, '') || '/'
    if (method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    if (p.startsWith('/_mock')) return this.control(method, p, req, res)
    if (this.config.mode !== 'mock') return this.proxied(method, p, req, res)

    const openai = p.startsWith('/v1/')
    const fail = openai ? openaiError : ollamaError
    try {
      const key = `${method} ${p}`
      switch (key) {
        case 'GET /':
        case 'HEAD /':
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end(method === 'HEAD' ? undefined : 'Ollama is running')
          return
        case 'GET /api/version':
          return sendJson(res, 200, { version: this.config.version })
        case 'GET /api/tags':
          return sendJson(res, 200, { models: this.models.map((m) => this.tagEntry(m)) })
        case 'GET /api/ps':
          return sendJson(res, 200, { models: this.psEntries() })
        case 'POST /api/show':
          return await this.show(await readBody(req), res)
        case 'POST /api/generate':
          return await this.generate('generate', req, res, await readBody(req))
        case 'POST /api/chat':
          return await this.generate('chat', req, res, await readBody(req))
        case 'POST /api/embed':
        case 'POST /api/embeddings':
          return await this.embeddings(
            p === '/api/embed' ? 'embed' : 'legacy',
            req,
            res,
            await readBody(req),
          )
        case 'POST /api/pull':
          return await this.pull(res, await readBody(req))
        case 'POST /api/create':
          return await this.create(res, await readBody(req))
        case 'POST /api/copy':
          return await this.copy(res, await readBody(req))
        case 'DELETE /api/delete':
          return await this.remove(res, await readBody(req))
        case 'GET /v1/models':
          return sendJson(res, 200, {
            object: 'list',
            data: this.models.map((m) => this.openaiModel(m)),
          })
        case 'POST /v1/chat/completions':
          return await this.generate('openai-chat', req, res, await readBody(req))
        case 'POST /v1/completions':
          return await this.generate('openai-completion', req, res, await readBody(req))
        case 'POST /v1/embeddings':
          return await this.embeddings('openai', req, res, await readBody(req))
      }
      if (method === 'GET' && p.startsWith('/v1/models/')) {
        const name = decodeURIComponent(p.slice('/v1/models/'.length))
        if (!this.knows(name)) return fail(res, 404, `model "${name}" not found`)
        return sendJson(res, 200, this.openaiModel(normalizeModel(name)))
      }
      if (method === 'HEAD' && p.startsWith('/api/blobs/')) {
        res.writeHead(200).end()
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 page not found')
    } catch (e) {
      if (e instanceof HttpError) fail(res, e.status, e.message)
      else throw e
    }
  }

  // --- models --------------------------------------------------------------------

  private knows(name: string): boolean {
    return this.models.some((m) => sameModel(m, name))
  }

  /** Throws 404 in strict mode for unknown models, as real Ollama does. */
  private checkModel(name: string): void {
    if (!name) throw new HttpError(400, 'model is required')
    if (this.config.strictModels && !this.knows(name))
      throw new HttpError(404, `model "${name}" not found, try pulling it first`)
  }

  private tagEntry(name: string) {
    const d = describeModel(name)
    return {
      name: d.name,
      model: d.name,
      modified_at: d.modifiedAt,
      size: d.size,
      digest: d.digest,
      details: d.details,
    }
  }

  private psEntries() {
    return this.loaded.list().map((l) => {
      const d = describeModel(l.name)
      return {
        name: d.name,
        model: d.name,
        size: d.size,
        digest: d.digest,
        details: d.details,
        expires_at: Number.isFinite(l.expiresAt)
          ? new Date(l.expiresAt).toISOString()
          : '2318-01-01T00:00:00Z',
        size_vram: d.size,
        context_length: Math.min(d.contextLength, 4096),
      }
    })
  }

  private openaiModel(name: string) {
    return {
      id: name,
      object: 'model',
      created: Math.floor(Date.parse(describeModel(name).modifiedAt) / 1000),
      owned_by: 'library',
    }
  }

  private show(body: unknown, res: ServerResponse): void {
    const b = isObj(body) ? body : {}
    const name = str(b.model) || str(b.name)
    if (!name) throw new HttpError(400, 'model is required')
    if (!this.knows(name) && this.config.strictModels)
      throw new HttpError(404, `model '${name}' not found`)
    const d = describeModel(name)
    sendJson(res, 200, {
      license: 'Mock model served by elecmockolla. Not a real model.',
      modelfile: `# Modelfile generated by elecmockolla\nFROM ${d.name}\n`,
      parameters: 'stop "<|eot_id|>"\ntemperature 0.7',
      template: '{{ .System }}\n{{ .Prompt }}',
      details: d.details,
      model_info: {
        'general.architecture': d.details.family,
        'general.parameter_count': Number.parseFloat(d.details.parameter_size) * 1e9,
        [`${d.details.family}.context_length`]: d.contextLength,
      },
      capabilities: d.capabilities,
      modified_at: d.modifiedAt,
    })
  }

  private pull(res: ServerResponse, body: unknown): Promise<void> {
    const b = isObj(body) ? body : {}
    const name = normalizeModel(str(b.model) || str(b.name))
    if (name === ':latest') throw new HttpError(400, 'model is required')
    const stream = b.stream !== false
    const rec = this.monitor.create('pull', 'POST', '/api/pull', name, stream, body)
    rec.state = 'streaming'
    rec.t.started = Date.now()
    const ac = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) ac.abort()
    })
    const d = describeModel(name)
    const layers = [
      { digest: `sha256:${d.digest}`, total: d.size },
      { digest: `sha256:${d.digest.split('').reverse().join('')}`, total: 1420 },
      { digest: `sha256:${d.digest.slice(8)}${d.digest.slice(0, 8)}`, total: 487 },
    ]
    return (async () => {
      const line = (o: unknown) => {
        if (!stream) return
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        res.write(`${JSON.stringify(o)}\n`)
      }
      line({ status: 'pulling manifest' })
      const steps = 20
      const per = this.config.pullMs / steps
      const main = layers[0] as { digest: string; total: number }
      for (let i = 1; i <= steps; i++) {
        if (!(await sleep(per, ac.signal))) {
          this.monitor.finish(rec, 'aborted', 499)
          return
        }
        line({
          status: `pulling ${main.digest.slice(7, 19)}`,
          digest: main.digest,
          total: main.total,
          completed: Math.round((main.total * i) / steps),
        })
        rec.tokens = i
        rec.plannedTokens = steps
      }
      for (const l of layers.slice(1))
        line({
          status: `pulling ${l.digest.slice(7, 19)}`,
          digest: l.digest,
          total: l.total,
          completed: l.total,
        })
      line({ status: 'verifying sha256 digest' })
      line({ status: 'writing manifest' })
      if (!this.knows(name)) this.models.push(name)
      if (stream) {
        line({ status: 'success' })
        res.end()
      } else sendJson(res, 200, { status: 'success' })
      rec.responseText = 'success'
      this.monitor.finish(rec, 'done', 200)
    })()
  }

  private create(res: ServerResponse, body: unknown): void {
    const b = isObj(body) ? body : {}
    const name = str(b.model) || str(b.name)
    if (!name) throw new HttpError(400, 'model is required')
    if (!this.knows(name)) this.models.push(normalizeModel(name))
    if (b.stream === false) {
      sendJson(res, 200, { status: 'success' })
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
    for (const status of [
      'reading model metadata',
      'creating system layer',
      'writing manifest',
      'success',
    ])
      res.write(`${JSON.stringify({ status })}\n`)
    res.end()
  }

  private copy(res: ServerResponse, body: unknown): void {
    const b = isObj(body) ? body : {}
    const src = str(b.source)
    const dst = str(b.destination)
    if (!src || !dst) throw new HttpError(400, 'source and destination are required')
    if (!this.knows(src)) throw new HttpError(404, `model "${src}" not found`)
    if (!this.knows(dst)) this.models.push(normalizeModel(dst))
    res.writeHead(200).end()
  }

  private remove(res: ServerResponse, body: unknown): void {
    const b = isObj(body) ? body : {}
    const name = str(b.model) || str(b.name)
    const i = this.models.findIndex((m) => sameModel(m, name))
    if (i < 0) throw new HttpError(404, `model '${name}' not found`)
    this.models.splice(i, 1)
    this.loaded.expire(name, 0)
    res.writeHead(200).end()
  }

  // --- faults ----------------------------------------------------------------------

  private pickFault(plan: Plan | null): FaultMode | null {
    const queued = this.pendingFaults.shift()
    if (queued) return queued
    if (plan?.fault) return plan.fault
    if (this.config.faultRate > 0 && Math.random() < this.config.faultRate) {
      const mode = this.config.faultMode
      return mode === 'random'
        ? (FAULT_MODES[Math.floor(Math.random() * FAULT_MODES.length)] as FaultMode)
        : mode
    }
    return null
  }

  // --- generation ------------------------------------------------------------------

  private async generate(
    api: Api,
    req: IncomingMessage,
    res: ServerResponse,
    raw: unknown,
    plan?: Planned,
  ): Promise<void> {
    const body = isObj(raw) ? raw : {}
    const parsed = parseRequest(api, body)
    const { prompt } = parsed
    const openai = api.startsWith('openai')
    const fail = openai ? openaiError : ollamaError
    this.checkModel(prompt.model)
    const model = prompt.model
    const keepAliveSec = parseKeepAlive(parsed.keepAlive, this.config.keepAliveSec)
    const path = new URL(req.url ?? '/', 'http://localhost').pathname

    // An empty prompt is Ollama's "load (or unload) this model" request.
    if (parsed.empty) {
      if (keepAliveSec <= 0) {
        this.loaded.expire(model, 0)
        return sendJson(res, 200, this.emptyReply(api, model, 'unload'))
      }
      const cold = this.loaded.touch(model, keepAliveSec)
      const ac = new AbortController()
      res.on('close', () => ac.abort())
      if (cold) await sleep(this.config.loadMs, ac.signal)
      return sendJson(res, 200, this.emptyReply(api, model, 'load'))
    }

    const rec = this.monitor.create(api, req.method ?? 'POST', path, model, parsed.stream, raw)
    rec.promptTokens = countTokens(prompt.all)
    const ac = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) ac.abort()
    })

    let slot: number
    try {
      slot = await this.scheduler.acquire(rec.id, ac.signal)
    } catch (e) {
      if (e instanceof QueueFullError) {
        fail(res, 503, e.message)
        this.monitor.finish(rec, 'error', 503, e.message)
      } else this.monitor.finish(rec, 'aborted', 499, 'client disconnected while queued')
      return
    }

    try {
      rec.slot = slot
      rec.t.started = Date.now()
      const planned = plan ?? this.replayPlan(parsed.prompt)
      await this.run(api, rec, res, parsed, keepAliveSec, ac.signal, planned)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (e instanceof AbortedError || ac.signal.aborted)
        this.monitor.finish(rec, 'aborted', 499, 'client disconnected')
      else {
        if (!res.headersSent) fail(res, 500, msg)
        else res.destroy()
        this.monitor.finish(rec, 'error', 500, msg)
      }
    } finally {
      this.scheduler.release(slot)
      this.loaded.expire(model, keepAliveSec)
    }
  }

  private emptyReply(api: Api, model: string, reason: 'load' | 'unload') {
    const base = { model, created_at: new Date().toISOString(), done: true, done_reason: reason }
    return api === 'chat'
      ? { ...base, message: { role: 'assistant', content: '' } }
      : { ...base, response: '' }
  }

  private writerFor(api: Api, res: ServerResponse, parsed: Parsed): Writer {
    const m = parsed.prompt.model
    switch (api) {
      case 'generate':
        return new OllamaGenerateWriter(res, parsed.stream, m)
      case 'chat':
        return new OllamaChatWriter(res, parsed.stream, m)
      case 'openai-completion':
        return new OpenAICompletionWriter(res, parsed.stream, m, parsed.includeUsage)
      default:
        return new OpenAIChatWriter(res, parsed.stream, m, parsed.includeUsage)
    }
  }

  private async run(
    api: Api,
    rec: RequestRecord,
    res: ServerResponse,
    parsed: Parsed,
    keepAliveSec: number,
    signal: AbortSignal,
    planned?: Planned,
  ): Promise<void> {
    const cfg = this.config
    const fail = api.startsWith('openai') ? openaiError : ollamaError
    const began = Date.now()

    // Model load.
    let loadMs = 0
    if (this.loaded.touch(parsed.prompt.model, Math.max(keepAliveSec, 1)) && cfg.loadMs > 0) {
      rec.state = 'loading'
      loadMs = jittered(Math.random, cfg.loadMs, cfg.jitter)
      if (!(await sleep(loadMs, signal))) throw new AbortedError()
    }
    rec.loadMs = Math.round(loadMs)

    const plan = planned ?? this.engine.plan(parsed.prompt)
    rec.match = plan.match
    const fault = this.pickFault(plan)
    rec.fault = fault

    const sequence = plan.chunks ?? [
      ...(plan.thinking ? tokenize(plan.thinking) : []).map((t) => ({ t, think: true })),
      ...tokenize(plan.text).map((t) => ({ t, think: false })),
    ]
    const limit = parsed.numPredict
    const total = sequence.length
    const truncated = total > limit
    const budget = truncated ? limit : total
    rec.plannedTokens = budget

    if (fault === 'error500') {
      rec.state = 'waiting'
      await sleep(Math.min(jittered(Math.random, cfg.ttftMs, cfg.jitter), 1000), signal)
      const msg = 'mock: injected internal server error'
      fail(res, 500, msg)
      this.monitor.finish(rec, 'error', 500, msg)
      return
    }
    if (fault === 'hang') {
      rec.state = 'waiting'
      await sleep(HANG_LIMIT_MS, signal)
      res.destroy()
      this.monitor.finish(rec, signal.aborted ? 'aborted' : 'error', 499, 'mock: injected hang')
      return
    }

    // Time to first token.
    rec.state = 'waiting'
    const ttft = jittered(Math.random, plan.ttftMs ?? cfg.ttftMs, cfg.jitter)
    if (!(await sleep(ttft, signal))) throw new AbortedError()
    const promptMs = ttft

    const writer = this.writerFor(api, res, parsed)
    const tps = plan.tps ?? cfg.tps
    const interval = tps > 0 ? 1000 / tps : 0
    const breakAt =
      fault === 'disconnect' || fault === 'malformed' ? Math.max(1, Math.floor(budget * 0.4)) : -1
    const streamStart = Date.now()
    let due = streamStart
    let emitted = 0
    let content = ''
    let thinking = ''

    const all = sequence.slice(0, budget)

    for (const tok of all) {
      if (interval > 0) {
        // Pace against an absolute schedule: timers on Windows fire late, and
        // this keeps the average rate right by sending a small burst to catch up.
        due += jittered(Math.random, interval, cfg.jitter)
        const wait = due - Date.now()
        if (wait > 1 && !(await sleep(wait, signal))) throw new AbortedError()
      }
      if (signal.aborted) throw new AbortedError()
      if (emitted === breakAt) {
        if (fault === 'malformed') {
          writer.garbage()
          res.end()
          this.monitor.finish(rec, 'error', 200, 'mock: injected malformed JSON')
        } else {
          // Let what was written reach the client first, then drop the connection.
          await new Promise<void>((resolve) => res.write('', () => resolve()))
          await sleep(20, signal)
          res.destroy()
          this.monitor.finish(rec, 'error', 200, 'mock: injected disconnect')
        }
        return
      }
      rec.state = tok.think ? 'thinking' : 'streaming'
      if (tok.think) {
        writer.thinking(tok.t)
        thinking += tok.t
      } else {
        writer.content(tok.t)
        content += tok.t
      }
      this.monitor.addTokens(rec, tok.t, tok.think)
      emitted++
    }

    if (!truncated && plan.toolCalls.length) {
      if (!rec.t.firstToken) rec.t.firstToken = Date.now()
      writer.tools(plan.toolCalls)
    }
    const evalMs = Date.now() - streamStart
    const stats: FinishStats = {
      doneReason: truncated ? 'length' : 'stop',
      promptTokens: rec.promptTokens,
      evalTokens: emitted,
      loadMs,
      promptMs,
      evalMs,
      totalMs: Date.now() - began,
      content,
      thinking,
      toolCalls: truncated ? [] : plan.toolCalls,
    }
    writer.finish(stats)
    if (plan.toolCalls.length && !truncated)
      rec.responseText += `\n[tool_calls] ${JSON.stringify(plan.toolCalls)}`
    if (plan.error) rec.error = plan.error
    this.monitor.finish(rec, 'done', 200)
  }

  // --- proxy and mixed modes --------------------------------------------------------

  private async proxied(
    method: string,
    p: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const openai = p.startsWith('/v1/')
    const fail = openai ? openaiError : ollamaError
    if (req.headers[HOP_HEADER]) {
      fail(res, 508, 'proxy loop: the upstream Ollama URL points back at this server')
      return
    }
    const api = PROXY_APIS[`${method} ${p}`]
    const signal = abortOnClose(res)
    try {
      if (!api) {
        await forward({
          upstream: this.config.upstream,
          method,
          path: req.url ?? '/',
          headers: req.headers,
          body: req,
          res,
          signal,
        })
        return
      }
      const raw = await readRaw(req)
      let body: unknown = {}
      try {
        body = parseJson(raw)
      } catch {
        // Not JSON: forward it anyway and let Ollama answer.
      }
      const obj = isObj(body) ? body : {}
      const generative = api !== 'embed' && api !== 'openai-embed'
      const parsed = generative ? parseRequest(api, obj) : null
      if (this.config.mode === 'mixed' && parsed && !parsed.empty) {
        const replay = this.replayPlan(parsed.prompt)
        if (replay) return await this.generate(api, req, res, body, replay)
        const plan = this.engine.plan(parsed.prompt)
        if (plan.match.source !== 'fallback') return await this.generate(api, req, res, body, plan)
      }
      // Load and unload requests (an empty prompt) pass through unrecorded, as in mock mode.
      if (parsed?.empty) {
        await forward({
          upstream: this.config.upstream,
          method,
          path: req.url ?? '/',
          headers: req.headers,
          body: raw,
          res,
          signal,
        })
        return
      }
      await this.forwardRecorded(api, req, res, raw, obj, parsed, signal)
    } catch (e) {
      if (e instanceof HttpError) fail(res, e.status, e.message)
      else if (e instanceof UpstreamError) fail(res, 502, e.message)
      else throw e
    }
  }

  /** Forwards one generation or embedding request and records it like a mock reply. */
  private async forwardRecorded(
    api: Api,
    req: IncomingMessage,
    res: ServerResponse,
    raw: Buffer,
    body: Obj,
    parsed: Parsed | null,
    signal: AbortSignal,
  ): Promise<void> {
    const fail = api.startsWith('openai') ? openaiError : ollamaError
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const model = str(body.model)
    const rec = this.monitor.create(
      api,
      req.method ?? 'POST',
      path,
      model,
      parsed?.stream ?? false,
      body,
    )
    rec.match = { source: 'upstream', name: new URL(this.config.upstream).host }
    const input = body.input ?? body.prompt
    rec.promptTokens = parsed
      ? countTokens(parsed.prompt.all)
      : (Array.isArray(input) ? input : [input]).reduce<number>(
          (n, s) => n + (typeof s === 'string' ? countTokens(s) : 0),
          0,
        )

    let slot: number
    try {
      slot = await this.scheduler.acquire(rec.id, signal)
    } catch (e) {
      if (e instanceof QueueFullError) {
        fail(res, 503, e.message)
        this.monitor.finish(rec, 'error', 503, e.message)
      } else this.monitor.finish(rec, 'aborted', 499, 'client disconnected while queued')
      return
    }

    try {
      rec.slot = slot
      rec.t.started = Date.now()
      // Ollama does not say it is loading; its /api/ps tells us whether the model is in memory.
      rec.state = this.upstream.isLoaded(model) ? 'waiting' : 'loading'
      const fault = this.pickFault(null)
      rec.fault = fault
      if (fault === 'error500') {
        const msg = 'mock: injected internal server error'
        fail(res, 500, msg)
        this.monitor.finish(rec, 'error', 500, msg)
        return
      }
      if (fault === 'hang') {
        rec.state = 'waiting'
        await sleep(HANG_LIMIT_MS, signal)
        res.destroy()
        this.monitor.finish(rec, signal.aborted ? 'aborted' : 'error', 499, 'mock: injected hang')
        return
      }

      const toolCalls: unknown[] = []
      const chunks: string[] = []
      const thinkingChunks: string[] = []
      const result = await forward({
        upstream: this.config.upstream,
        method: req.method ?? 'POST',
        path: req.url ?? '/',
        headers: req.headers,
        body: raw,
        res,
        signal,
        api,
        fault,
        onHeaders: (status) => {
          rec.status = status
        },
        onPiece: (piece) => {
          toolCalls.push(...piece.toolCalls)
          if (piece.thinking) {
            rec.state = 'thinking'
            thinkingChunks.push(piece.thinking)
            this.monitor.addTokens(rec, piece.thinking, true)
          }
          if (piece.content) {
            rec.state = 'streaming'
            chunks.push(piece.content)
            this.monitor.addTokens(rec, piece.content, false)
          }
        },
      })

      const reader = result.reader
      const stats = reader?.stats ?? null
      if (stats) {
        rec.reported = stats
        rec.loadMs = stats.loadMs
        if (stats.promptTokens) rec.promptTokens = stats.promptTokens
        if (stats.evalTokens) this.monitor.setTokens(rec, stats.evalTokens)
        // A reply that arrived in one piece: place the first token where Ollama says it was.
        if (!parsed?.stream && (stats.loadMs || stats.promptMs))
          rec.t.firstToken = Math.min(Date.now(), rec.t.started + stats.loadMs + stats.promptMs)
      }
      if (reader?.vectors) {
        this.monitor.setTokens(rec, reader.vectors)
        rec.responseText = `${reader.vectors} vector(s)`
      }
      if (toolCalls.length) rec.responseText += `\n[tool_calls] ${JSON.stringify(toolCalls)}`

      const ok = !result.aborted && !result.faulted && result.status < 400
      if (ok && this.config.record && parsed)
        this.record(api, rec, parsed.prompt, parsed.stream, chunks, thinkingChunks, toolCalls)

      if (result.aborted) this.monitor.finish(rec, 'aborted', 499, 'client disconnected')
      else if (result.faulted)
        this.monitor.finish(rec, 'error', result.status, `mock: injected ${fault}`)
      else if (result.status >= 400)
        this.monitor.finish(rec, 'error', result.status, reader?.error || `HTTP ${result.status}`)
      else this.monitor.finish(rec, 'done', result.status)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (signal.aborted) this.monitor.finish(rec, 'aborted', 499, 'client disconnected')
      else {
        if (!res.headersSent) fail(res, 502, msg)
        else res.destroy()
        this.monitor.finish(rec, 'error', 502, msg)
      }
    } finally {
      this.scheduler.release(slot)
      void this.upstream.poll()
    }
  }

  /** Keeps a reply of the real Ollama for playback. The first reply to an input is kept. */
  private record(
    api: Api,
    rec: RequestRecord,
    prompt: Prompt,
    streamed: boolean,
    chunks: string[],
    thinking: string[],
    rawToolCalls: unknown[],
  ): void {
    const toolCalls = toolCallsOf(rawToolCalls)
    if (!chunks.length && !toolCalls.length) return
    if (this.recordings.find(prompt.model, prompt.all)) return
    // A reply that came in one piece is split like mock replies, so it still streams on playback.
    const split = (pieces: string[]) => (streamed ? pieces : tokenize(pieces.join('')))
    const now = Date.now()
    const stats = rec.reported
    const firstMs = rec.t.firstToken ? rec.t.firstToken - rec.t.started : 0
    const ttftMs = stats?.promptMs || Math.max(0, firstMs - (stats?.loadMs ?? 0))
    const span = rec.t.firstToken ? (now - rec.t.firstToken) / 1000 : 0
    const tps = stats?.evalMs
      ? (stats.evalTokens * 1000) / stats.evalMs
      : span > 0 && chunks.length > 1
        ? chunks.length / span
        : 0
    const recording: Recording = {
      id: recordingId(prompt.model, prompt.all),
      model: normalizeModel(prompt.model),
      api,
      prompt: prompt.last,
      conversation: prompt.all,
      chunks: split(chunks),
      thinking: split(thinking),
      toolCalls,
      ttftMs: Math.round(ttftMs),
      tps: Math.round(tps * 10) / 10,
      recordedAt: new Date(now).toISOString(),
      source: this.config.upstream,
    }
    if (this.recordings.add(recording)) this.onRecorded?.(recording)
  }

  // --- embeddings ------------------------------------------------------------------

  private async embeddings(
    kind: 'embed' | 'legacy' | 'openai',
    req: IncomingMessage,
    res: ServerResponse,
    raw: unknown,
  ): Promise<void> {
    const body = isObj(raw) ? raw : {}
    const fail = kind === 'openai' ? openaiError : ollamaError
    const model = str(body.model)
    this.checkModel(model)
    const input = kind === 'legacy' ? body.prompt : body.input
    const inputs = (Array.isArray(input) ? input : [input]).map((x) =>
      typeof x === 'string' ? x : '',
    )
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const rec = this.monitor.create(
      kind === 'openai' ? 'openai-embed' : 'embed',
      'POST',
      path,
      model,
      false,
      raw,
    )
    rec.promptTokens = inputs.reduce((n, s) => n + countTokens(s), 0)
    const ac = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) ac.abort()
    })
    let slot: number
    try {
      slot = await this.scheduler.acquire(rec.id, ac.signal)
    } catch (e) {
      if (e instanceof QueueFullError) {
        fail(res, 503, e.message)
        this.monitor.finish(rec, 'error', 503, e.message)
      } else this.monitor.finish(rec, 'aborted', 499)
      return
    }
    const began = Date.now()
    try {
      rec.slot = slot
      rec.t.started = began
      const keepAliveSec = parseKeepAlive(body.keep_alive, this.config.keepAliveSec)
      let loadMs = 0
      if (this.loaded.touch(model, Math.max(keepAliveSec, 1)) && this.config.loadMs > 0) {
        rec.state = 'loading'
        loadMs = jittered(Math.random, this.config.loadMs, this.config.jitter)
        if (!(await sleep(loadMs, ac.signal))) throw new AbortedError()
      }
      rec.loadMs = Math.round(loadMs)
      const fault = this.pickFault(null)
      rec.fault = fault
      rec.state = 'waiting'
      const delay = jittered(
        Math.random,
        Math.min(this.config.ttftMs, 80) * inputs.length ** 0.5,
        this.config.jitter,
      )
      if (!(await sleep(delay, ac.signal))) throw new AbortedError()
      if (fault === 'hang') {
        await sleep(HANG_LIMIT_MS, ac.signal)
        res.destroy()
        this.monitor.finish(rec, 'aborted', 499, 'mock: injected hang')
        return
      }
      if (fault) {
        if (fault === 'disconnect') res.destroy()
        else if (fault === 'malformed') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"embeddings":[[0.1,')
        } else fail(res, 500, 'mock: injected internal server error')
        this.monitor.finish(
          rec,
          'error',
          fault === 'error500' ? 500 : 200,
          `mock: injected ${fault}`,
        )
        return
      }
      const dimsReq =
        typeof body.dimensions === 'number' && body.dimensions > 0 ? body.dimensions : 0
      const dim = dimsReq || this.config.embedDim
      const vectors = inputs.map((s) => embed(s, dim, model))
      const totalNs = (Date.now() - began) * 1e6
      if (kind === 'legacy') sendJson(res, 200, { embedding: vectors[0] ?? [] })
      else if (kind === 'embed')
        sendJson(res, 200, {
          model,
          embeddings: vectors,
          total_duration: totalNs,
          load_duration: Math.round(loadMs * 1e6),
          prompt_eval_count: rec.promptTokens,
        })
      else {
        // The OpenAI SDKs ask for base64 (little-endian float32) by default.
        const base64 = body.encoding_format === 'base64'
        const encode = (v: number[]) => Buffer.from(new Float32Array(v).buffer).toString('base64')
        sendJson(res, 200, {
          object: 'list',
          data: vectors.map((v, index) => ({
            object: 'embedding',
            embedding: base64 ? encode(v) : v,
            index,
          })),
          model,
          usage: { prompt_tokens: rec.promptTokens, total_tokens: rec.promptTokens },
        })
      }
      rec.tokens = inputs.length
      rec.plannedTokens = inputs.length
      rec.responseText = `${vectors.length} vector(s) × ${dim} dims`
      this.monitor.finish(rec, 'done', 200)
    } catch (e) {
      if (ac.signal.aborted) this.monitor.finish(rec, 'aborted', 499)
      else {
        fail(res, 500, e instanceof Error ? e.message : String(e))
        this.monitor.finish(rec, 'error', 500, String(e))
      }
    } finally {
      this.scheduler.release(slot)
    }
  }

  // --- control plane (/_mock/*) ------------------------------------------------------

  private async control(
    method: string,
    p: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      const key = `${method} ${p}`
      switch (key) {
        case 'GET /_mock/status': {
          const { finished: _drop, ...rest } = this.snapshotNoDrain()
          return sendJson(res, 200, rest)
        }
        case 'GET /_mock/requests':
          return sendJson(res, 200, { requests: this.monitor.recent() })
        case 'GET /_mock/events':
          return this.events(res)
        case 'GET /_mock/rules':
          return sendJson(res, 200, this.engine.getRules())
        case 'GET /_mock/recordings':
          return sendJson(res, 200, { recordings: this.recordings.all() })
        case 'PUT /_mock/rules':
          this.setRules(normalizeRules(await readBody(req)))
          return sendJson(res, 200, this.engine.getRules())
        case 'GET /_mock/config':
          return sendJson(res, 200, this.config)
        case 'PATCH /_mock/config': {
          const patch = await readBody(req)
          if (!isObj(patch)) throw new HttpError(400, 'expected an object')
          this.setConfig(patchConfig(this.config, patch))
          return sendJson(res, 200, this.config)
        }
        case 'POST /_mock/fault': {
          const b = await readBody(req)
          const mode = isObj(b) ? b.mode : undefined
          if (!FAULT_MODES.includes(mode as FaultMode))
            throw new HttpError(400, `mode must be one of ${FAULT_MODES.join(', ')}`)
          const count = isObj(b) && typeof b.count === 'number' ? b.count : 1
          this.injectFault(mode as FaultMode, count)
          return sendJson(res, 200, { pending: this.pendingFaults })
        }
        case 'DELETE /_mock/fault':
          this.clearFaults()
          return sendJson(res, 200, { pending: [] })
        case 'POST /_mock/test': {
          const b = await readBody(req)
          if (!isObj(b)) throw new HttpError(400, 'expected an object')
          return sendJson(
            res,
            200,
            this.test({
              prompt: str(b.prompt),
              system: str(b.system),
              model: str(b.model),
              think: b.think === true,
            }),
          )
        }
        case 'POST /_mock/reset':
          this.resetStats()
          this.loaded.clear()
          this.clearFaults()
          return sendJson(res, 200, { ok: true })
      }
      sendJson(res, 404, { error: `unknown control endpoint ${key}` })
    } catch (e) {
      if (e instanceof HttpError || e instanceof RulesError)
        sendJson(res, e instanceof HttpError ? e.status : 400, { error: e.message })
      else throw e
    }
  }

  private snapshotNoDrain(): Snapshot {
    return this.snapshot(false)
  }

  private events(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    this.sseClients.add(res)
    res.on('close', () => this.sseClients.delete(res))
    if (!this.sseTimer)
      this.sseTimer = setInterval(() => {
        if (!this.sseClients.size) return
        const { finished: _f, ...snap } = this.snapshotNoDrain()
        const data = `data: ${JSON.stringify(snap)}\n\n`
        for (const c of this.sseClients) c.write(data)
      }, 500)
  }
}
