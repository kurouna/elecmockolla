import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { HostStatus, ServerStatus } from '../shared/api.ts'
import type {
  FaultMode,
  MockConfig,
  Recording,
  RequestRecord,
  RulesFile,
  Snapshot,
} from '../shared/types.ts'
import type { WorkerIn, WorkerOut } from './server.worker.ts'

const WORKER = fileURLToPath(new URL('./server.worker.js', import.meta.url))
const HISTORY = 500

/**
 * Owns the server's utility process: start, stop, live updates, and the
 * latest snapshot plus request history for pages that open later.
 * Emits 'status' (HostStatus), 'snapshot' (Snapshot), 'recorded' (Recording) and
 * 'changed' ({config?, rules?}: what the control API changed).
 */
export class ServerHost extends EventEmitter {
  private child: UtilityProcess | null = null
  /** The stop in progress, which a start or a second stop waits for. */
  private stopping: Promise<HostStatus> | null = null
  private status: ServerStatus = 'stopped'
  private url = ''
  private error = ''
  private code = ''
  snapshot: Snapshot | null = null
  history: RequestRecord[] = []

  getStatus(): HostStatus {
    return { status: this.status, url: this.url, error: this.error, code: this.code }
  }

  private setStatus(status: ServerStatus, error = '', code = ''): void {
    this.status = status
    this.error = error
    this.code = code
    if (status !== 'running') this.url = status === 'starting' ? this.url : ''
    this.emit('status', this.getStatus())
  }

  get running(): boolean {
    return this.status === 'running'
  }

  get serverUrl(): string {
    return this.url
  }

  start(config: MockConfig, rules: RulesFile, recordings: Recording[]): Promise<HostStatus> {
    // Started while stopping: wait for the stop, then start afresh.
    if (this.stopping) return this.stopping.then(() => this.start(config, rules, recordings))
    if (this.child) return Promise.resolve(this.getStatus())
    this.setStatus('starting')
    const child = utilityProcess.fork(WORKER, [], {
      serviceName: 'elecmockolla server',
      stdio: 'inherit',
    })
    this.child = child
    return new Promise((resolve) => {
      let settled = false
      const settle = () => {
        if (!settled) {
          settled = true
          resolve(this.getStatus())
        }
      }
      child.on('message', (m: WorkerOut) => {
        switch (m.type) {
          case 'listening':
            // Stopped before it came up: the stop wins, and no "exited" error follows.
            if (this.child !== child || this.status === 'stopping') {
              settle()
              break
            }
            this.url = m.url
            this.setStatus('running')
            settle()
            break
          case 'failed': {
            const hint =
              m.code === 'EADDRINUSE'
                ? `Port ${config.port} is already in use. Is the real Ollama running? Change the port in Settings.`
                : m.message
            this.setStatus('error', hint, m.code)
            this.child = null
            child.kill()
            settle()
            break
          }
          case 'snapshot':
            this.onSnapshot(m.snapshot)
            break
          case 'recorded':
            this.emit('recorded', m.recording)
            break
          case 'changed':
            this.emit('changed', { config: m.config, rules: m.rules })
            break
          case 'stopped':
            break
        }
      })
      child.on('exit', (code) => {
        if (this.child === child) {
          this.child = null
          if (this.status !== 'error')
            this.setStatus(
              this.status === 'stopping' ? 'stopped' : 'error',
              this.status === 'stopping' ? '' : `server process exited (${code})`,
            )
        }
        settle()
      })
      this.post({ type: 'start', config, rules, recordings })
    })
  }

  stop(): Promise<HostStatus> {
    const child = this.child
    if (!child) {
      if (this.status !== 'error') this.setStatus('stopped')
      return Promise.resolve(this.getStatus())
    }
    if (this.stopping) return this.stopping
    this.setStatus('stopping')
    this.stopping = new Promise((resolve) => {
      const force = setTimeout(() => child.kill(), 3000)
      child.once('exit', () => {
        clearTimeout(force)
        this.child = null
        this.stopping = null
        this.setStatus('stopped')
        resolve(this.getStatus())
      })
      this.post({ type: 'stop' })
    })
    return this.stopping
  }

  private post(m: WorkerIn): void {
    this.child?.postMessage(m)
  }

  setConfig(config: MockConfig): void {
    this.post({ type: 'config', config })
  }

  setRecordings(recordings: Recording[]): void {
    this.post({ type: 'recordings', recordings })
  }

  setRules(rules: RulesFile): void {
    this.post({ type: 'rules', rules })
  }

  injectFault(mode: FaultMode, count: number): void {
    this.post({ type: 'fault', mode, count })
  }

  clearFaults(): void {
    this.post({ type: 'clearFaults' })
  }

  resetStats(): void {
    this.history = []
    this.post({ type: 'reset' })
  }

  private onSnapshot(s: Snapshot): void {
    this.snapshot = s
    if (s.finished.length) {
      this.history.push(...s.finished)
      if (this.history.length > HISTORY) this.history.splice(0, this.history.length - HISTORY)
    }
    this.emit('snapshot', s)
  }
}
