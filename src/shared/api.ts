/**
 * The contract between the UI and the main process: `window.mockolla`.
 * Type-only, like types.ts.
 */
import type {
  FaultMode,
  MockConfig,
  Preset,
  Recording,
  RequestRecord,
  RulesFile,
  Snapshot,
  TestInput,
  TestResult,
} from './types.ts'

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface HostStatus {
  status: ServerStatus
  url: string
  error: string
  /** A machine-readable cause, e.g. 'EADDRINUSE', so the UI can explain it in its language. */
  code: string
}

export interface AppState extends HostStatus {
  version: string
  /** A problem with the files on disk, e.g. an invalid rules.json. */
  notice: string
  envPath: string
  rulesPath: string
  recordingsPath: string
  config: MockConfig
  rules: RulesFile
  recordings: Recording[]
  presets: Preset[]
  /** Finished requests, oldest first. */
  history: RequestRecord[]
  snapshot: Snapshot | null
}

export type SaveResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type PlaygroundApi = 'chat' | 'generate' | 'openai'

export interface PlaygroundRequest {
  api: PlaygroundApi
  model: string
  prompt: string
  system: string
  stream: boolean
  think: boolean
  json: boolean
}

export type PlaygroundEvent =
  | { id: number; type: 'request'; method: string; url: string; body: unknown }
  | { id: number; type: 'status'; status: number }
  | { id: number; type: 'chunk'; content: string; thinking: string; raw: string }
  | { id: number; type: 'done'; ms: number; raw: string }
  | { id: number; type: 'error'; message: string }

export interface LoadGenOptions {
  concurrency: number
  total: number
  api: PlaygroundApi
  /** Pick a random model from the list for each request. */
  randomModels: boolean
}

export interface LoadGenStatus {
  running: boolean
  sent: number
  ok: number
  failed: number
  total: number
}

export interface MockollaApi {
  getState(): Promise<AppState>
  start(): Promise<HostStatus>
  stop(): Promise<HostStatus>
  restart(): Promise<HostStatus>
  saveConfig(patch: Partial<MockConfig>): Promise<SaveResult<MockConfig>>
  applyPreset(id: string): Promise<SaveResult<MockConfig>>
  saveRules(rules: RulesFile): Promise<SaveResult<RulesFile>>
  defaultRules(): Promise<RulesFile>
  /** Deletes recordings by id ('all' clears the file); returns what is left. */
  deleteRecordings(ids: string[] | 'all'): Promise<Recording[]>
  /** Runs the rule engine on `rules` (a draft) or on the saved rules. */
  testRules(input: TestInput & { think?: boolean }, rules?: RulesFile): Promise<TestResult>
  injectFault(mode: FaultMode, count: number): Promise<void>
  clearFaults(): Promise<void>
  resetStats(): Promise<void>
  playground(req: PlaygroundRequest): Promise<number>
  cancelPlayground(id: number): Promise<void>
  loadGen(opts: LoadGenOptions): Promise<void>
  stopLoadGen(): Promise<void>
  openFolder(): Promise<void>
  copy(text: string): Promise<void>
  /** Recolours the native window controls to match the page theme. */
  setTheme(theme: 'dark' | 'light'): Promise<void>
  onSnapshot(cb: (s: Snapshot) => void): () => void
  onStatus(cb: (s: HostStatus) => void): () => void
  onPlayground(cb: (e: PlaygroundEvent) => void): () => void
  onLoadGen(cb: (s: LoadGenStatus) => void): () => void
  onRecordings(cb: (r: Recording[]) => void): () => void
}
