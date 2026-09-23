/**
 * The mock server, running in an Electron utilityProcess so a busy or hung
 * server can never freeze the window. It is the same MockServer the CLI runs.
 *
 * Protocol over process.parentPort:
 *   in:  start {config, rules} | config {config} | rules {rules} | fault {mode, count}
 *        | clearFaults | reset | stop
 *   out: listening {url} | failed {message, code} | snapshot {snapshot} | stopped
 */
import { MockServer } from '../core/server.ts'
import type { FaultMode, MockConfig, RulesFile } from '../shared/types.ts'

export type WorkerIn =
  | { type: 'start'; config: MockConfig; rules: RulesFile }
  | { type: 'config'; config: MockConfig }
  | { type: 'rules'; rules: RulesFile }
  | { type: 'fault'; mode: FaultMode; count: number }
  | { type: 'clearFaults' }
  | { type: 'reset' }
  | { type: 'stop' }

export type WorkerOut =
  | { type: 'listening'; url: string }
  | { type: 'failed'; message: string; code: string }
  | { type: 'snapshot'; snapshot: ReturnType<MockServer['snapshot']> }
  | { type: 'stopped' }

const SNAPSHOT_MS = 200

const port = process.parentPort
let server: MockServer | null = null
let timer: NodeJS.Timeout | null = null

const send = (m: WorkerOut) => port.postMessage(m)

async function start(config: MockConfig, rules: RulesFile): Promise<void> {
  server = new MockServer({ config, rules })
  try {
    const url = await server.start()
    send({ type: 'listening', url })
    timer = setInterval(() => {
      if (server) send({ type: 'snapshot', snapshot: server.snapshot() })
    }, SNAPSHOT_MS)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    send({ type: 'failed', message: err.message, code: err.code ?? '' })
    server = null
  }
}

port.on('message', (e: { data: WorkerIn }) => {
  const m = e.data
  switch (m.type) {
    case 'start':
      void start(m.config, m.rules)
      break
    case 'config':
      server?.setConfig(m.config)
      break
    case 'rules':
      server?.setRules(m.rules)
      break
    case 'fault':
      server?.injectFault(m.mode, m.count)
      break
    case 'clearFaults':
      server?.clearFaults()
      break
    case 'reset':
      server?.resetStats()
      break
    case 'stop':
      if (timer) clearInterval(timer)
      void (server?.stop() ?? Promise.resolve()).then(() => {
        send({ type: 'stopped' })
        process.exit(0)
      })
      break
  }
})
