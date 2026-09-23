/**
 * HTTP clients the UI drives through main (the renderer has no network):
 * the playground, which sends one real request and streams it back, and the
 * load generator, which fills the dashboard with concurrent traffic.
 */
import type {
  LoadGenOptions,
  LoadGenStatus,
  PlaygroundEvent,
  PlaygroundRequest,
} from '../shared/api.ts'

type Emit<T> = (e: T) => void

function buildRequest(
  url: string,
  r: PlaygroundRequest,
): { url: string; body: Record<string, unknown> } {
  const messages = [
    ...(r.system ? [{ role: 'system', content: r.system }] : []),
    { role: 'user', content: r.prompt },
  ]
  switch (r.api) {
    case 'generate':
      return {
        url: `${url}/api/generate`,
        body: {
          model: r.model,
          prompt: r.prompt,
          ...(r.system ? { system: r.system } : {}),
          stream: r.stream,
          ...(r.think ? { think: true } : {}),
          ...(r.json ? { format: 'json' } : {}),
        },
      }
    case 'chat':
      return {
        url: `${url}/api/chat`,
        body: {
          model: r.model,
          messages,
          stream: r.stream,
          ...(r.think ? { think: true } : {}),
          ...(r.json ? { format: 'json' } : {}),
        },
      }
    case 'openai':
      return {
        url: `${url}/v1/chat/completions`,
        body: {
          model: r.model,
          messages,
          stream: r.stream,
          ...(r.stream ? { stream_options: { include_usage: true } } : {}),
          ...(r.think ? { reasoning_effort: 'medium' } : {}),
          ...(r.json ? { response_format: { type: 'json_object' } } : {}),
        },
      }
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null

/** Pulls content and thinking out of any of the three wire formats. */
function pieces(o: unknown): { content: string; thinking: string } {
  if (!isObj(o)) return { content: '', thinking: '' }
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  if (isObj(o.message)) {
    const calls = o.message.tool_calls
    return {
      content:
        s(o.message.content) +
        (Array.isArray(calls) ? `\n[tool_calls] ${JSON.stringify(calls)}` : ''),
      thinking: s(o.message.thinking),
    }
  }
  if ('response' in o) return { content: s(o.response), thinking: s(o.thinking) }
  if (Array.isArray(o.choices)) {
    const c = o.choices[0]
    if (!isObj(c)) return { content: '', thinking: '' }
    const m = isObj(c.delta) ? c.delta : isObj(c.message) ? c.message : {}
    const calls = m.tool_calls
    return {
      content:
        s(m.content) + (Array.isArray(calls) ? `\n[tool_calls] ${JSON.stringify(calls)}` : ''),
      thinking: s(m.reasoning),
    }
  }
  return { content: '', thinking: '' }
}

export class Playground {
  private next = 1
  private running = new Map<number, AbortController>()

  send(base: string, r: PlaygroundRequest, emit: Emit<PlaygroundEvent>): number {
    const id = this.next++
    const ac = new AbortController()
    this.running.set(id, ac)
    void this.run(id, base, r, ac, emit).finally(() => this.running.delete(id))
    return id
  }

  cancel(id: number): void {
    this.running.get(id)?.abort()
  }

  private async run(
    id: number,
    base: string,
    r: PlaygroundRequest,
    ac: AbortController,
    emit: Emit<PlaygroundEvent>,
  ) {
    const t0 = Date.now()
    const { url, body } = buildRequest(base, r)
    emit({ id, type: 'request', method: 'POST', url, body })
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      emit({ id, type: 'status', status: res.status })
      if (!res.body) throw new Error('no response body')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let raw = ''
      const handleLine = (line: string) => {
        const t = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
        if (!t || t === '[DONE]') return
        let o: unknown
        try {
          o = JSON.parse(t)
        } catch {
          emit({ id, type: 'chunk', content: '', thinking: '', raw: line })
          return
        }
        emit({ id, type: 'chunk', ...pieces(o), raw: t })
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const text = dec.decode(value, { stream: true })
        raw += text
        buf += text
        // A non-streamed reply is one JSON document, possibly pretty-printed.
        if (!r.stream) continue
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) handleLine(line)
      }
      if (buf.trim()) handleLine(r.stream ? buf : buf.replace(/\n/g, ' '))
      emit({
        id,
        type: 'done',
        ms: Date.now() - t0,
        raw: raw.length > 200_000 ? `${raw.slice(0, 200_000)}…` : raw,
      })
    } catch (e) {
      emit({
        id,
        type: 'error',
        message: ac.signal.aborted ? 'cancelled' : e instanceof Error ? e.message : String(e),
      })
    }
  }
}

const LOAD_PROMPTS = [
  'hello there',
  'Explain how a mock server helps testing.',
  'これは何ですか？',
  '/json',
  'weather in Tokyo',
  '/code',
  'my name is Alice',
  '東京の天気は？',
  'Summarise the plot of a movie you like.',
  'ありがとう',
]

export class LoadGenerator {
  private ac: AbortController | null = null
  status: LoadGenStatus = { running: false, sent: 0, ok: 0, failed: 0, total: 0 }

  stop(): void {
    this.ac?.abort()
  }

  async run(
    base: string,
    models: string[],
    o: LoadGenOptions,
    emit: Emit<LoadGenStatus>,
  ): Promise<void> {
    this.stop()
    const ac = new AbortController()
    this.ac = ac
    const total = Math.max(1, Math.min(o.total, 10_000))
    const concurrency = Math.max(1, Math.min(o.concurrency, 256))
    const st: LoadGenStatus = { running: true, sent: 0, ok: 0, failed: 0, total }
    this.status = st
    const chatModels = models.filter((m) => !/embed/i.test(m))
    const pickModel = (i: number) =>
      (o.randomModels
        ? chatModels[Math.floor(Math.random() * chatModels.length)]
        : chatModels[0]) ?? `model-${i}`
    let lastEmit = 0
    const tick = (force = false) => {
      const now = Date.now()
      if (force || now - lastEmit > 100) {
        lastEmit = now
        emit({ ...st })
      }
    }
    const worker = async () => {
      while (!ac.signal.aborted && st.sent < total) {
        const i = st.sent++
        const req: PlaygroundRequest = {
          api: o.api,
          model: pickModel(i),
          prompt: LOAD_PROMPTS[i % LOAD_PROMPTS.length] ?? 'hi',
          system: '',
          stream: true,
          think: false,
          json: false,
        }
        const { url, body } = buildRequest(base, req)
        tick()
        try {
          const res = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(body),
            signal: ac.signal,
          })
          await res.arrayBuffer()
          if (res.ok) st.ok++
          else st.failed++
        } catch {
          if (!ac.signal.aborted) st.failed++
        }
        tick()
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    st.running = false
    if (this.ac === ac) this.ac = null
    tick(true)
  }
}
