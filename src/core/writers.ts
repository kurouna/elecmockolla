import type { ServerResponse } from 'node:http'
import type { ToolCall } from './engine.ts'
import { createRng, hashString, uuid } from './random.ts'

/** Numbers every API reports when a reply is done. Durations in ms. */
export interface FinishStats {
  doneReason: 'stop' | 'length'
  promptTokens: number
  evalTokens: number
  loadMs: number
  promptMs: number
  evalMs: number
  totalMs: number
  content: string
  thinking: string
  toolCalls: ToolCall[]
}

/** Turns a paced reply into one API's wire format. */
export interface Writer {
  thinking(token: string): void
  content(token: string): void
  tools(calls: ToolCall[]): void
  finish(stats: FinishStats): void
  /** Writes a line that is not valid JSON, for the "malformed" fault. */
  garbage(): void
  /** True once headers have gone out: errors can then no longer change the status. */
  readonly started: boolean
}

const ns = (ms: number): number => Math.round(ms * 1e6)
const nowIso = (): string => new Date().toISOString()

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export const ollamaError = (res: ServerResponse, status: number, message: string): void =>
  sendJson(res, status, { error: message })

export const openaiError = (res: ServerResponse, status: number, message: string): void =>
  sendJson(res, status, {
    error: {
      message,
      type: status >= 500 ? 'api_error' : 'invalid_request_error',
      param: null,
      code: null,
    },
  })

abstract class BaseWriter implements Writer {
  protected res: ServerResponse
  protected stream: boolean
  started = false

  constructor(res: ServerResponse, stream: boolean) {
    this.res = res
    this.stream = stream
  }

  protected abstract contentType: string

  protected begin(): void {
    if (this.started) return
    this.started = true
    this.res.writeHead(200, {
      'Content-Type': this.contentType,
      ...(this.stream ? { 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } : {}),
    })
  }

  protected line(obj: unknown): void {
    this.begin()
    this.res.write(`${JSON.stringify(obj)}\n`)
  }

  abstract thinking(token: string): void
  abstract content(token: string): void
  abstract tools(calls: ToolCall[]): void
  abstract finish(stats: FinishStats): void

  garbage(): void {
    this.begin()
    this.res.write('{"model":"mock","created_at":"broken",\n')
  }
}

const durations = (s: FinishStats) => ({
  total_duration: ns(s.totalMs),
  load_duration: ns(s.loadMs),
  prompt_eval_count: s.promptTokens,
  prompt_eval_duration: ns(s.promptMs),
  eval_count: s.evalTokens,
  eval_duration: ns(s.evalMs),
})

/** Ollama tool calls: arguments stay an object. */
const ollamaTools = (calls: ToolCall[]) =>
  calls.map((c, index) => ({ function: { index, name: c.name, arguments: c.arguments } }))

export class OllamaGenerateWriter extends BaseWriter {
  protected contentType: string
  private model: string

  constructor(res: ServerResponse, stream: boolean, model: string) {
    super(res, stream)
    this.model = model
    this.contentType = stream ? 'application/x-ndjson' : 'application/json; charset=utf-8'
  }

  thinking(token: string): void {
    if (this.stream)
      this.line({
        model: this.model,
        created_at: nowIso(),
        response: '',
        thinking: token,
        done: false,
      })
  }

  content(token: string): void {
    if (this.stream)
      this.line({ model: this.model, created_at: nowIso(), response: token, done: false })
  }

  tools(): void {
    // /api/generate has no tool calls.
  }

  finish(s: FinishStats): void {
    const context = Array.from(
      { length: Math.min(s.promptTokens + s.evalTokens, 64) },
      (_, i) => hashString(`${this.model}${i}`) % 128000,
    )
    const body = {
      model: this.model,
      created_at: nowIso(),
      response: this.stream ? '' : s.content,
      ...(!this.stream && s.thinking ? { thinking: s.thinking } : {}),
      done: true,
      done_reason: s.doneReason,
      context,
      ...durations(s),
    }
    this.line(body)
    this.res.end()
  }
}

export class OllamaChatWriter extends BaseWriter {
  protected contentType: string
  private model: string

  constructor(res: ServerResponse, stream: boolean, model: string) {
    super(res, stream)
    this.model = model
    this.contentType = stream ? 'application/x-ndjson' : 'application/json; charset=utf-8'
  }

  private msg(message: Record<string, unknown>, done = false) {
    return {
      model: this.model,
      created_at: nowIso(),
      message: { role: 'assistant', ...message },
      done,
    }
  }

  thinking(token: string): void {
    if (this.stream) this.line(this.msg({ content: '', thinking: token }))
  }

  content(token: string): void {
    if (this.stream) this.line(this.msg({ content: token }))
  }

  tools(calls: ToolCall[]): void {
    if (this.stream && calls.length)
      this.line(this.msg({ content: '', tool_calls: ollamaTools(calls) }))
  }

  finish(s: FinishStats): void {
    const message: Record<string, unknown> = { content: this.stream ? '' : s.content }
    if (!this.stream && s.thinking) message.thinking = s.thinking
    if (!this.stream && s.toolCalls.length) message.tool_calls = ollamaTools(s.toolCalls)
    this.line({ ...this.msg(message, true), done_reason: s.doneReason, ...durations(s) })
    this.res.end()
  }
}

const openaiId = (prefix: string): string =>
  `${prefix}-${uuid(createRng(Date.now() ^ (Math.random() * 1e9)))
    .replace(/-/g, '')
    .slice(0, 24)}`

const openaiTools = (calls: ToolCall[]) =>
  calls.map((c, index) => ({
    index,
    id: openaiId('call'),
    type: 'function',
    function: { name: c.name, arguments: JSON.stringify(c.arguments) },
  }))

const usage = (s: FinishStats) => ({
  prompt_tokens: s.promptTokens,
  completion_tokens: s.evalTokens,
  total_tokens: s.promptTokens + s.evalTokens,
})

abstract class SseWriter extends BaseWriter {
  protected contentType: string

  constructor(res: ServerResponse, stream: boolean) {
    super(res, stream)
    this.contentType = stream ? 'text/event-stream' : 'application/json; charset=utf-8'
  }

  protected event(obj: unknown): void {
    this.begin()
    this.res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  override garbage(): void {
    this.begin()
    this.res.write(this.stream ? 'data: {"id":"chatcmpl-broken","choices":[\n\n' : '{"id":')
  }
}

export class OpenAIChatWriter extends SseWriter {
  private id = openaiId('chatcmpl')
  private created = Math.floor(Date.now() / 1000)
  private model: string
  private includeUsage: boolean

  constructor(res: ServerResponse, stream: boolean, model: string, includeUsage: boolean) {
    super(res, stream)
    this.model = model
    this.includeUsage = includeUsage
  }

  private chunk(delta: Record<string, unknown>, finish: string | null = null) {
    return {
      id: this.id,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      system_fingerprint: 'fp_ollama',
      choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: finish }],
    }
  }

  thinking(token: string): void {
    if (this.stream) this.event(this.chunk({ content: '', reasoning: token }))
  }

  content(token: string): void {
    if (this.stream) this.event(this.chunk({ content: token }))
  }

  tools(calls: ToolCall[]): void {
    if (this.stream && calls.length) this.event(this.chunk({ tool_calls: openaiTools(calls) }))
  }

  finish(s: FinishStats): void {
    const finish = s.toolCalls.length ? 'tool_calls' : s.doneReason
    if (this.stream) {
      this.event(this.chunk({ content: '' }, finish))
      if (this.includeUsage)
        this.event({
          id: this.id,
          object: 'chat.completion.chunk',
          created: this.created,
          model: this.model,
          system_fingerprint: 'fp_ollama',
          choices: [],
          usage: usage(s),
        })
      this.begin()
      this.res.end('data: [DONE]\n\n')
      return
    }
    const message: Record<string, unknown> = { role: 'assistant', content: s.content }
    if (s.thinking) message.reasoning = s.thinking
    if (s.toolCalls.length) message.tool_calls = openaiTools(s.toolCalls)
    this.begin()
    this.res.end(
      JSON.stringify({
        id: this.id,
        object: 'chat.completion',
        created: this.created,
        model: this.model,
        system_fingerprint: 'fp_ollama',
        choices: [{ index: 0, message, finish_reason: finish }],
        usage: usage(s),
      }),
    )
  }
}

export class OpenAICompletionWriter extends SseWriter {
  private id = openaiId('cmpl')
  private created = Math.floor(Date.now() / 1000)
  private model: string
  private includeUsage: boolean

  constructor(res: ServerResponse, stream: boolean, model: string, includeUsage: boolean) {
    super(res, stream)
    this.model = model
    this.includeUsage = includeUsage
  }

  private chunk(text: string, finish: string | null = null) {
    return {
      id: this.id,
      object: 'text_completion',
      created: this.created,
      model: this.model,
      system_fingerprint: 'fp_ollama',
      choices: [{ text, index: 0, finish_reason: finish }],
    }
  }

  thinking(): void {
    // The legacy completions API has no reasoning channel.
  }

  content(token: string): void {
    if (this.stream) this.event(this.chunk(token))
  }

  tools(): void {}

  finish(s: FinishStats): void {
    if (this.stream) {
      this.event(this.chunk('', s.doneReason))
      if (this.includeUsage) this.event({ ...this.chunk(''), choices: [], usage: usage(s) })
      this.begin()
      this.res.end('data: [DONE]\n\n')
      return
    }
    this.begin()
    this.res.end(JSON.stringify({ ...this.chunk(s.content, s.doneReason), usage: usage(s) }))
  }
}
