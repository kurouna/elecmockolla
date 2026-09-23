/**
 * Proxy and mixed modes: forwards requests to a real Ollama and reads the reply
 * on the way through, so the dashboard can show real traffic like mock traffic.
 * The bytes reach the client unchanged; parsing happens on a copy.
 */
import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import https from 'node:https'
import type { Api, ReportedTimings, UpstreamInfo } from '../shared/types.ts'
import { upstreamRoot } from './config.ts'
import { normalizeModel } from './models.ts'

/** Marks forwarded requests. A request that comes back with it is a proxy loop. */
export const HOP_HEADER = 'x-mockolla-hop'

/** Lines passed on before an injected disconnect or broken line, so the client sees a started reply. */
const BREAK_AFTER = 8

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const nsToMs = (v: unknown): number => Math.round(num(v) / 1e6)

export class UpstreamError extends Error {}

/** One piece of a reply: a stream chunk, or the whole body of a non-streamed reply. */
interface Piece {
  content: string
  thinking: string
  toolCalls: unknown[]
}

/** Extracts text and timings from Ollama and OpenAI-style reply objects. */
export class ReplyReader {
  stats: ReportedTimings | null = null
  /** The error message of a failed reply ({"error": ...}). */
  error = ''
  vectors = 0
  private decoder = new TextDecoder()
  private buf = ''
  private kind: 'ndjson' | 'sse' | 'json'
  private api: Api

  constructor(api: Api, contentType: string) {
    this.api = api
    this.kind = contentType.includes('text/event-stream')
      ? 'sse'
      : contentType.includes('ndjson')
        ? 'ndjson'
        : 'json'
  }

  /** Feeds a chunk; returns the pieces completed by it. */
  push(chunk: Buffer): Piece[] {
    this.buf += this.decoder.decode(chunk, { stream: true })
    if (this.kind === 'json') return []
    const lines = this.buf.split('\n')
    this.buf = lines.pop() ?? ''
    return lines.flatMap((l) => this.line(l))
  }

  /** The end of the body; a non-streamed reply is parsed here. */
  end(): Piece[] {
    this.buf += this.decoder.decode()
    const rest = this.buf
    this.buf = ''
    if (this.kind === 'json') return this.object(tryJson(rest))
    return this.line(rest)
  }

  private line(raw: string): Piece[] {
    let l = raw.trim()
    if (this.kind === 'sse') {
      if (!l.startsWith('data:')) return []
      l = l.slice(5).trim()
      if (l === '[DONE]') return []
    }
    return l ? this.object(tryJson(l)) : []
  }

  private object(o: unknown): Piece[] {
    if (!isObj(o)) return []
    if (o.error !== undefined) {
      this.error = isObj(o.error) ? str(o.error.message) : str(o.error)
      return []
    }
    if (this.api === 'embed' || this.api === 'openai-embed') {
      this.vectors = Array.isArray(o.embeddings)
        ? o.embeddings.length
        : Array.isArray(o.data)
          ? o.data.length
          : Array.isArray(o.embedding)
            ? 1
            : 0
      this.ollamaStats(o)
      if (isObj(o.usage)) this.setStats({ promptTokens: num(o.usage.prompt_tokens) })
      return []
    }
    if (Array.isArray(o.choices)) return this.openai(o)
    const msg = isObj(o.message) ? o.message : {}
    const piece: Piece = {
      content: str(msg.content) || str(o.response),
      thinking: str(msg.thinking) || str(o.thinking),
      toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    }
    if (o.done === true) this.ollamaStats(o)
    return [piece]
  }

  private openai(o: Obj): Piece[] {
    if (isObj(o.usage))
      this.setStats({
        promptTokens: num(o.usage.prompt_tokens),
        evalTokens: num(o.usage.completion_tokens),
      })
    const c = (o.choices as unknown[])[0]
    if (!isObj(c)) return []
    const m = isObj(c.delta) ? c.delta : isObj(c.message) ? c.message : {}
    return [
      {
        content: str(m.content) || str(c.text),
        thinking: str(m.reasoning) || str(m.reasoning_content),
        toolCalls: Array.isArray(m.tool_calls) ? m.tool_calls : [],
      },
    ]
  }

  private ollamaStats(o: Obj): void {
    if (o.total_duration === undefined && o.eval_count === undefined) return
    this.setStats({
      loadMs: nsToMs(o.load_duration),
      promptMs: nsToMs(o.prompt_eval_duration),
      evalMs: nsToMs(o.eval_duration),
      totalMs: nsToMs(o.total_duration),
      promptTokens: num(o.prompt_eval_count),
      evalTokens: num(o.eval_count),
    })
  }

  private setStats(s: Partial<ReportedTimings>): void {
    const base = this.stats ?? {
      loadMs: 0,
      promptMs: 0,
      evalMs: 0,
      totalMs: 0,
      promptTokens: 0,
      evalTokens: 0,
    }
    this.stats = { ...base, ...s }
  }
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export interface ForwardOptions {
  upstream: string
  method: string
  /** Path and query, e.g. "/api/chat". */
  path: string
  headers: IncomingHttpHeaders
  /** A buffered body, or the incoming request to stream through. */
  body: Buffer | IncomingMessage
  res: ServerResponse
  signal: AbortSignal
  /** Set to parse the reply; plain pass-through otherwise. */
  api?: Api
  onHeaders?: (status: number) => void
  onPiece?: (p: Piece) => void
  /** Cut the reply partway: drop the connection, or send a broken line and end. */
  fault?: 'disconnect' | 'malformed' | null
}

export interface ForwardResult {
  status: number
  reader: ReplyReader | null
  /** The injected fault took effect. */
  faulted: boolean
  aborted: boolean
}

/** Sends one request upstream and streams the reply to `res`. */
export function forward(o: ForwardOptions): Promise<ForwardResult> {
  // The client's path is kept whole: /v1/chat/completions and /api/chat both go to the root.
  const target = new URL(`${upstreamRoot(o.upstream)}${o.path}`)
  const headers: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(o.headers))
    if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v
  headers[HOP_HEADER] = '1'
  if (Buffer.isBuffer(o.body)) headers['content-length'] = String(o.body.length)
  else if (o.headers['content-length']) headers['content-length'] = o.headers['content-length']
  else if (o.headers['transfer-encoding']) headers['transfer-encoding'] = 'chunked'

  const lib = target.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    let settled = false
    const done = (r: ForwardResult | Error) => {
      if (settled) return
      settled = true
      if (r instanceof Error) reject(r)
      else resolve(r)
    }
    const up = lib.request(target, { method: o.method, headers }, (ur) => {
      const status = ur.statusCode ?? 502
      const out: Record<string, string | string[]> = {}
      for (const [k, v] of Object.entries(ur.headers))
        if (v !== undefined && !HOP_BY_HOP.has(k) && !k.startsWith('access-control-')) out[k] = v
      if (ur.headers['content-length']) out['content-length'] = ur.headers['content-length']
      const reader = o.api ? new ReplyReader(o.api, str(ur.headers['content-type'])) : null
      o.onHeaders?.(status)
      const streamed =
        reader !== null &&
        status < 400 &&
        !str(ur.headers['content-type']).includes('application/json')
      const fault = status < 400 ? (o.fault ?? null) : null
      let faulted = false

      // A non-streamed reply that should fail: fail before anything is sent.
      if (fault && !streamed) {
        faulted = true
        ur.destroy()
        if (fault === 'malformed') {
          o.res.writeHead(status, {
            'content-type': str(ur.headers['content-type']) || 'application/json',
          })
          o.res.end('{"model":')
        } else o.res.destroy()
        return done({ status, reader, faulted, aborted: false })
      }
      o.res.writeHead(status, out)
      const pass = (c: Buffer) => {
        o.res.write(c)
        if (reader) for (const p of reader.push(c)) o.onPiece?.(p)
      }

      // With a fault to inject, lines go out one at a time and the newest is held back,
      // so the cut always lands before the final line, however the chunks arrive.
      const decoder = new TextDecoder()
      let partial = ''
      let held: string | null = null
      let sent = 0
      const cut = () => {
        faulted = true
        ur.destroy()
        if (fault === 'malformed') {
          const sse = str(ur.headers['content-type']).includes('event-stream')
          o.res.end(sse ? 'data: {"id":"broken","choices":[\n\n' : '{"model":"broken",\n')
        } else o.res.write('', () => setTimeout(() => o.res.destroy(), 20))
        done({ status, reader, faulted, aborted: false })
      }

      ur.on('data', (c: Buffer) => {
        if (faulted) return
        if (!fault) return pass(c)
        partial += decoder.decode(c, { stream: true })
        const lines = partial.split('\n')
        partial = lines.pop() ?? ''
        for (const line of lines) {
          if (held !== null) {
            pass(Buffer.from(`${held}\n`))
            if (held.trim()) sent++
          }
          held = line
          if (sent >= BREAK_AFTER) return cut()
        }
      })
      ur.on('end', () => {
        if (faulted) return
        if (fault) return cut()
        if (reader) for (const p of reader.end()) o.onPiece?.(p)
        o.res.end()
        done({ status, reader, faulted, aborted: false })
      })
      ur.on('error', () => {
        if (faulted) return
        o.res.destroy()
        done({ status, reader, faulted, aborted: o.signal.aborted })
      })
    })
    up.on('error', (e) => {
      if (o.signal.aborted)
        return done({ status: 499, reader: null, faulted: false, aborted: true })
      // A refused "localhost" is an AggregateError (IPv6 and IPv4) with an empty message.
      const why = e.message || (e as NodeJS.ErrnoException).code || String(e)
      done(new UpstreamError(`Ollama at ${o.upstream} is not reachable: ${why}`))
    })
    const onAbort = () => up.destroy()
    o.signal.addEventListener('abort', onAbort, { once: true })
    o.res.on('close', () => {
      o.signal.removeEventListener('abort', onAbort)
      if (!o.res.writableFinished) {
        up.destroy()
        done({ status: 499, reader: null, faulted: false, aborted: true })
      }
    })
    if (Buffer.isBuffer(o.body)) up.end(o.body)
    else o.body.pipe(up)
  })
}

/** Polls the real Ollama for its version, models and loaded models. */
export class UpstreamWatch {
  info: UpstreamInfo | null = null
  private timer: NodeJS.Timeout | null = null
  private url = ''
  /** The poll in flight, which a second caller waits for rather than starting another. */
  private inflight: Promise<void> | null = null
  private intervalMs: number

  constructor(intervalMs = 3000) {
    this.intervalMs = intervalMs
  }

  /** Starts, retargets or stops polling. */
  configure(enabled: boolean, url: string): void {
    if (!enabled) {
      this.stop()
      this.info = null
      return
    }
    if (url !== this.url || !this.timer) {
      this.stop()
      this.url = url
      this.info = {
        url,
        ok: false,
        error: '',
        version: '',
        models: [],
        loaded: [],
        checkedAt: 0,
      }
      void this.poll()
      this.timer = setInterval(() => void this.poll(), this.intervalMs)
      this.timer.unref()
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** True when the model is known to be in memory upstream. */
  isLoaded(model: string): boolean {
    const n = normalizeModel(model)
    return this.info?.loaded.some((l) => l.name === n) ?? false
  }

  /** Polls now, e.g. right after a reply, so a newly loaded model shows up at once. */
  poll(): Promise<void> {
    if (!this.url) return Promise.resolve()
    this.inflight ??= this.fetchInfo().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async fetchInfo(): Promise<void> {
    const url = this.url
    const root = upstreamRoot(url)
    try {
      const [v, tags, ps] = await Promise.all(
        ['/api/version', '/api/tags', '/api/ps'].map((p) => getJson(`${root}${p}`)),
      )
      if (url !== this.url) return
      const names = (o: unknown) =>
        isObj(o) && Array.isArray(o.models) ? o.models.filter(isObj) : []
      this.info = {
        url,
        ok: true,
        error: '',
        version: isObj(v) ? str(v.version) : '',
        models: names(tags).map((m) => normalizeModel(str(m.name) || str(m.model))),
        loaded: names(ps).map((m) => ({
          name: normalizeModel(str(m.name) || str(m.model)),
          expiresAt: Date.parse(str(m.expires_at)) || Number.POSITIVE_INFINITY,
          sizeVram: num(m.size_vram),
        })),
        checkedAt: Date.now(),
      }
    } catch (e) {
      if (url === this.url && this.info)
        this.info = {
          ...this.info,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          loaded: [],
          checkedAt: Date.now(),
        }
    }
  }
}

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, {
    headers: { [HOP_HEADER]: '1' },
    signal: AbortSignal.timeout(2500),
  })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json()
}
