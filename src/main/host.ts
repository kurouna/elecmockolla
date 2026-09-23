import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { HostStatus, ServerStatus } from '../shared/api.ts'
import type { FaultMode, MockConfig, RequestRecord, RulesFile, Snapshot } from '../shared/types.ts'
import type { WorkerIn, WorkerOut } from './server.worker.ts'

const WORKER = fileURLToPath(new URL('./server.worker.js', import.meta.url))
const HISTORY = 500

/**
 * Owns the server's utility process: start, stop, live updates, and the
 * latest snapshot plus request history for pages that open later.
 * Emits 'status' (HostStatus) and 'snapshot' (Snapshot).
 */
export class ServerHost extends EventEmitter {
  private child: UtilityProcess | null = null
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

  start(config: MockConfig, rules: RulesFile): Promise<HostStatus> {
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
      this.post({ type: 'start', config, rules })
    })
  }

  stop(): Promise<HostStatus> {
    const child = this.child
    if (!child) {
      if (this.status !== 'error') this.setStatus('stopped')
      return Promise.resolve(this.getStatus())
    }
    this.setStatus('stopping')
    return new Promise((resolve) => {
      const force = setTimeout(() => child.kill(), 3000)
      child.once('exit', () => {
        clearTimeout(force)
        this.child = null
        this.setStatus('stopped')
        resolve(this.getStatus())
      })
      this.post({ type: 'stop' })
    })
  }

  private post(m: WorkerIn): void {
    this.child?.postMessage(m)
  }

  setConfig(config: MockConfig): void {
    this.post({ type: 'config', config })
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
