/**
 * Request history as files: elecmockolla's own JSON (every field it records) and
 * HAR 1.2, the HTTP archive that browser dev tools and HAR viewers open.
 *
 * A record keeps the reply's text, not its bytes on the wire, so a HAR response body
 * is that text (thinking included) and its mime type is text/plain; the fields HAR has
 * no place for travel in `_elecmockolla`, as HAR allows for custom fields.
 */
import type { ExportFormat, RequestRecord } from '../shared/types.ts'

export const EXPORT_FORMATS: readonly ExportFormat[] = ['json', 'har']

export interface ExportMeta {
  /** The server's base URL, e.g. http://127.0.0.1:11434, for full request URLs. */
  url: string
  version: string
  mode: string
  exportedAt?: Date
}

export function toJsonExport(records: RequestRecord[], meta: ExportMeta): string {
  const doc = {
    app: 'elecmockolla',
    version: meta.version,
    exportedAt: (meta.exportedAt ?? new Date()).toISOString(),
    server: meta.url,
    mode: meta.mode,
    requests: records,
  }
  return `${JSON.stringify(doc, null, 2)}\n`
}

const iso = (t: number) => new Date(t).toISOString()
const span = (a: number, b: number) => (a && b && b >= a ? b - a : -1)

function harEntry(r: RequestRecord, base: string) {
  const end = r.t.ended || Date.now()
  const body = r.requestBody === undefined ? '' : JSON.stringify(r.requestBody)
  const text = r.thinkingText ? `${r.thinkingText}\n\n${r.responseText}` : r.responseText
  const blocked = span(r.t.received, r.t.started)
  const wait = span(r.t.started, r.t.firstToken || (r.t.ended ? end : 0))
  const receive = r.t.firstToken ? span(r.t.firstToken, end) : 0
  return {
    startedDateTime: iso(r.t.received),
    time: Math.max(0, end - r.t.received),
    request: {
      method: r.method,
      url: `${base}${r.path}`,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [{ name: 'Content-Type', value: 'application/json' }],
      queryString: [],
      postData: { mimeType: 'application/json', text: body },
      headersSize: -1,
      bodySize: body.length,
    },
    response: {
      status: r.state === 'aborted' ? 0 : r.status,
      statusText: r.error,
      httpVersion: 'HTTP/1.1',
      cookies: [],
      headers: [],
      content: { size: text.length, mimeType: 'text/plain; charset=utf-8', text },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    // HAR's phases: blocked = waiting for a slot, wait = to the first token, receive = streaming.
    timings: { blocked, dns: -1, connect: -1, ssl: -1, send: 0, wait: Math.max(0, wait), receive },
    _elecmockolla: {
      id: r.id,
      api: r.api,
      model: r.model,
      stream: r.stream,
      state: r.state,
      slot: r.slot,
      match: r.match,
      fault: r.fault,
      loadMs: r.loadMs,
      promptTokens: r.promptTokens,
      tokens: r.tokens,
      reported: r.reported,
    },
  }
}

export function toHar(records: RequestRecord[], meta: ExportMeta): string {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'elecmockolla', version: meta.version },
      pages: [],
      entries: records.map((r) => harEntry(r, meta.url)),
      comment: `elecmockolla ${meta.mode} mode, exported ${(meta.exportedAt ?? new Date()).toISOString()}. Response bodies are the reply text, not the bytes on the wire.`,
    },
  }
  return `${JSON.stringify(har, null, 2)}\n`
}

export const exportRequests = (format: ExportFormat, records: RequestRecord[], meta: ExportMeta) =>
  format === 'har' ? toHar(records, meta) : toJsonExport(records, meta)
