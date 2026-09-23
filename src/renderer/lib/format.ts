import type { MatchInfo, RequestRecord, RequestState } from '../../shared/types.ts'
import { t } from './i18n.svelte.ts'

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
  const sec = Math.round(ms / 1000)
  return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '–'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return Math.round(n).toLocaleString('en-US')
}

export function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`
}

export const fmtClock = (t: number): string =>
  t ? new Date(t).toLocaleTimeString('en-GB', { hour12: false }) : '–'

export function ttft(r: RequestRecord): number {
  return r.t.firstToken && r.t.started ? r.t.firstToken - r.t.started : Number.NaN
}

export function duration(r: RequestRecord, now = Date.now()): number {
  return (r.t.ended || now) - r.t.received
}

/** Streaming rate of one request, tokens per second. */
export function rate(r: RequestRecord, now = Date.now()): number {
  if (!r.t.firstToken || r.tokens < 2) return 0
  const span = ((r.t.ended || now) - r.t.firstToken) / 1000
  return span > 0 ? r.tokens / span : 0
}

export function percentile(values: number[], p: number): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return Number.NaN
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] ?? Number.NaN
}

export const STATE_CHIP: Record<RequestState, string> = {
  queued: '',
  loading: 'violet',
  waiting: 'amber',
  thinking: 'blue',
  streaming: 'accent',
  done: 'green',
  error: 'red',
  aborted: '',
}

export function statusChip(r: RequestRecord): { label: string; cls: string } {
  if (r.state === 'aborted') return { label: t('state.aborted'), cls: 'amber' }
  if (r.state === 'error' || r.status >= 400)
    return { label: r.status >= 400 ? String(r.status) : t('state.fault'), cls: 'red' }
  if (r.state === 'done') return { label: String(r.status), cls: 'green' }
  return { label: t(`state.${r.state}`), cls: STATE_CHIP[r.state] }
}

/** "rule: greeting", with the source in the UI language; "→ Ollama" for proxied replies. */
export const matchLabel = (m: MatchInfo): string =>
  m.source === 'upstream' ? `→ ${t('source.upstream')}` : `${t(`source.${m.source}`)}: ${m.name}`

export function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}

export const API_LABEL: Record<string, string> = {
  generate: '/api/generate',
  chat: '/api/chat',
  embed: '/api/embed',
  pull: '/api/pull',
  'openai-chat': '/v1/chat',
  'openai-completion': '/v1/completions',
  'openai-embed': '/v1/embeddings',
}

/** A curl command that replays the request against the running server. */
export function curlFor(r: RequestRecord, base: string): string {
  const body = JSON.stringify(r.requestBody)
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`
  return `curl ${base}${r.path} -H 'Content-Type: application/json' -d ${q(body)}`
}
