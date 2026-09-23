/**
 * Recorded replies: what the real Ollama answered (in proxy and mixed modes),
 * kept in recordings.json and played back by the mock for the same input.
 *
 * The input is stored as it was sent. Matching compares a key made from it that
 * ignores case, full/half width, spaces, punctuation and symbols, so "Hello, world!"
 * and "hello world" are the same prompt. The key is never stored: it is rebuilt
 * on load, so changing how keys are made cannot orphan old recordings.
 */
import { createHash } from 'node:crypto'
import type { Api, Recording } from '../shared/types.ts'
import { normalizeModel } from './models.ts'
import { RulesError } from './rules.ts'

const APIS: Api[] = ['generate', 'chat', 'openai-chat', 'openai-completion']

/** The text as matched: NFKC, lower case, without spaces, punctuation or symbols. */
export function matchText(s: string): string {
  const key = s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Z}\s]+/gu, '')
  // A prompt of nothing but symbols ("？") keeps its own text, so it stays distinct.
  return key || s.trim()
}

export const recordingKey = (model: string, conversation: string): string =>
  `${normalizeModel(model)}\n${matchText(conversation)}`

export function recordingId(model: string, conversation: string): string {
  return `rec-${createHash('sha256').update(recordingKey(model, conversation)).digest('hex').slice(0, 12)}`
}

/** The recordings in memory, indexed by key. The first recording of an input wins. */
export class RecordingStore {
  private list: Recording[] = []
  private byKey = new Map<string, Recording>()

  constructor(recordings: Recording[] = []) {
    this.set(recordings)
  }

  set(recordings: Recording[]): void {
    this.list = []
    this.byKey.clear()
    for (const r of recordings) this.add(r)
  }

  all(): Recording[] {
    return [...this.list]
  }

  get size(): number {
    return this.list.length
  }

  find(model: string, conversation: string): Recording | undefined {
    return this.byKey.get(recordingKey(model, conversation))
  }

  /** Adds a recording; false when that input is already recorded. */
  add(r: Recording): boolean {
    const key = recordingKey(r.model, r.conversation)
    if (this.byKey.has(key)) return false
    this.byKey.set(key, r)
    this.list.push(r)
    return true
  }
}

// --- validation ------------------------------------------------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const nonNeg = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0

function normalizeRecording(v: unknown, i: number): Recording {
  const where = `recordings[${i}]`
  if (!isObj(v)) throw new RulesError(`${where} must be an object`)
  const model = str(v.model)
  const conversation = str(v.conversation)
  if (!model) throw new RulesError(`${where}.model is required`)
  if (!conversation.trim()) throw new RulesError(`${where}.conversation is required`)
  const toolCalls = Array.isArray(v.toolCalls)
    ? v.toolCalls.filter(isObj).map((t) => ({ name: str(t.name), arguments: t.arguments ?? {} }))
    : []
  return {
    id: str(v.id) || recordingId(model, conversation),
    model: normalizeModel(model),
    api: APIS.includes(v.api as Api) ? (v.api as Api) : 'chat',
    prompt: str(v.prompt),
    conversation,
    chunks: strings(v.chunks),
    thinking: strings(v.thinking),
    toolCalls: toolCalls.filter((t) => t.name),
    ttftMs: nonNeg(v.ttftMs),
    tps: nonNeg(v.tps),
    recordedAt: str(v.recordedAt),
    source: str(v.source),
  }
}

/** Validates a recordings file (or a bare array). Throws RulesError. */
export function normalizeRecordings(v: unknown): Recording[] {
  const list = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.recordings) ? v.recordings : null
  if (!list) throw new RulesError('the recordings file must be {"recordings": [...]}')
  return list.map(normalizeRecording)
}

export function parseRecordings(json: string): Recording[] {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    throw new RulesError(`recordings file is not valid JSON: ${e instanceof Error ? e.message : e}`)
  }
  return normalizeRecordings(data)
}

export const recordingsToJson = (recordings: Recording[]): string =>
  `${JSON.stringify({ version: 1, recordings }, null, 2)}\n`
