import type { Api, RequestRecord, Totals } from '../shared/types.ts'

const HISTORY = 500
const SERIES = 120
/** Longest response text kept per record, so a runaway reply cannot eat memory. */
const MAX_TEXT = 64 * 1024

/** Strips huge strings (base64 images, long documents) from a request body before it is kept. */
export function sanitizeBody(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 4000 ? `${v.slice(0, 4000)}… (${v.length} chars)` : v
  if (depth > 8 || v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => sanitizeBody(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) out[k] = sanitizeBody(x, depth + 1)
  return out
}

/** Keeps every request's record and the per-second series the dashboard charts. */
export class Monitor {
  private nextId = 1
  readonly active = new Map<number, RequestRecord>()
  private history: RequestRecord[] = []
  private unsent: RequestRecord[] = []
  totals: Totals = { requests: 0, completed: 0, errors: 0, aborted: 0, rejected: 0, tokens: 0 }

  private sec = Math.floor(Date.now() / 1000)
  private curTokens = 0
  private curRequests = 0
  readonly tps: number[] = new Array(SERIES).fill(0)
  readonly rps: number[] = new Array(SERIES).fill(0)
  readonly busy: number[] = new Array(SERIES).fill(0)
  readonly queued: number[] = new Array(SERIES).fill(0)

  /** Current gauges, sampled when a second rolls over. */
  sample: () => { busy: number; queued: number } = () => ({ busy: 0, queued: 0 })

  /** Called with every finished record (the CLI logs it). */
  onFinish: ((r: RequestRecord) => void) | null = null

  create(
    api: Api,
    method: string,
    path: string,
    model: string,
    stream: boolean,
    body: unknown,
  ): RequestRecord {
    this.roll()
    this.curRequests++
    this.totals.requests++
    const rec: RequestRecord = {
      id: this.nextId++,
      api,
      method,
      path,
      model,
      stream,
      state: 'queued',
      status: 200,
      slot: null,
      match: null,
      fault: null,
      t: { received: Date.now(), started: 0, firstToken: 0, ended: 0 },
      loadMs: 0,
      promptTokens: 0,
      tokens: 0,
      plannedTokens: 0,
      requestBody: sanitizeBody(body),
      responseText: '',
      thinkingText: '',
      error: '',
      reported: null,
    }
    this.active.set(rec.id, rec)
    return rec
  }

  addTokens(rec: RequestRecord, text: string, thinking: boolean, count = 1): void {
    this.roll()
    if (!rec.t.firstToken) rec.t.firstToken = Date.now()
    rec.tokens += count
    this.curTokens += count
    this.totals.tokens += count
    if (thinking) {
      if (rec.thinkingText.length < MAX_TEXT) rec.thinkingText += text
    } else if (rec.responseText.length < MAX_TEXT) rec.responseText += text
  }

  /** Corrects a record's token count to an exact figure (a proxied reply's eval_count). */
  setTokens(rec: RequestRecord, tokens: number): void {
    this.roll()
    const diff = tokens - rec.tokens
    rec.tokens = tokens
    this.curTokens = Math.max(0, this.curTokens + diff)
    this.totals.tokens += diff
  }

  finish(
    rec: RequestRecord,
    state: 'done' | 'error' | 'aborted',
    status = rec.status,
    error = '',
  ): void {
    if (!this.active.has(rec.id)) return
    rec.state = state
    rec.status = status
    rec.t.ended = Date.now()
    if (error) rec.error = error
    this.active.delete(rec.id)
    if (state === 'done') this.totals.completed++
    else if (state === 'aborted') this.totals.aborted++
    else if (status === 503) this.totals.rejected++
    else this.totals.errors++
    this.history.push(rec)
    if (this.history.length > HISTORY) this.history.shift()
    this.unsent.push(rec)
    if (this.unsent.length > HISTORY) this.unsent.shift()
    this.onFinish?.(rec)
  }

  /** Advances the per-second series up to now. */
  roll(now = Date.now()): void {
    const sec = Math.floor(now / 1000)
    if (sec <= this.sec) return
    const gap = Math.min(sec - this.sec, SERIES)
    const g = this.sample()
    for (let i = 0; i < gap; i++) {
      const first = i === 0
      this.push(this.tps, first ? this.curTokens : 0)
      this.push(this.rps, first ? this.curRequests : 0)
      this.push(this.busy, g.busy)
      this.push(this.queued, g.queued)
    }
    this.curTokens = 0
    this.curRequests = 0
    this.sec = sec
  }

  private push(arr: number[], v: number): void {
    arr.push(v)
    if (arr.length > SERIES) arr.shift()
  }

  /** Records finished since the last call. */
  takeFinished(): RequestRecord[] {
    const out = this.unsent
    this.unsent = []
    return out
  }

  recent(): RequestRecord[] {
    return [...this.history]
  }

  reset(): void {
    this.history = []
    this.unsent = []
    this.totals = { requests: 0, completed: 0, errors: 0, aborted: 0, rejected: 0, tokens: 0 }
    for (const a of [this.tps, this.rps, this.busy, this.queued]) a.fill(0)
  }
}
