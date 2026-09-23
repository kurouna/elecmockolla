#!/usr/bin/env node
/**
 * elecmockolla CLI. Runs straight from source under Node's type stripping:
 *   node src/core/cli.ts serve
 * The Electron app runs the same MockServer in a utility process.
 */
import { existsSync, readFileSync, watch } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { MockConfig, RequestRecord } from '../shared/types.ts'
import {
  applyPreset,
  normalizeUpstream,
  PRESETS,
  patchConfig,
  presetById,
  SERVER_MODES,
} from './config.ts'
import { initFiles, loadConfig, loadRecordings, loadRules, saveRecordings } from './files.ts'
import { RulesError } from './rules.ts'
import { MockServer } from './server.ts'

const HELP = `elecmockolla - a mock Ollama server

Usage:
  elecmockolla serve [options]     start the server (default command)
  elecmockolla init [--force]      write .env and rules.json with defaults
  elecmockolla check               validate .env and the rules file
  elecmockolla presets             list speed presets

Options:
  -e, --env <file>        settings file (default: ./.env)
  -r, --rules <file>      rules file (default: MOCKOLLA_RULES in .env, else ./rules.json)
  -H, --host <host>       listen address
  -p, --port <port>       port (0 = any free port)
  -n, --parallel <n>      parallel slots
      --preset <id>       instant | fast | realistic | slow | demo
      --ttft <ms>         time to first token
      --tps <n>           tokens per second (0 = no delay)
      --seed <n>          fixed seed for reproducible replies
      --strict            unknown models get 404
      --mode <mode>       mock | proxy (forward to a real Ollama) | mixed (rules first)
      --upstream <url>    the real Ollama for proxy and mixed (default: http://127.0.0.1:11434/v1)
      --record            save the real Ollama's replies to recordings.json (proxy, mixed)
      --replay            answer recorded prompts with the recorded reply (mock, mixed)
      --json              log one JSON object per finished request
  -q, --quiet             no per-request log
  -h, --help
  -v, --version

Settings come from defaults < .env < MOCKOLLA_* environment < options.
Control API: GET /_mock/status, /_mock/events (SSE), PUT /_mock/rules, POST /_mock/fault ...`

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}
const color = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (f: (s: string) => string, s: string) => (color ? f(s) : s)

function version(): string {
  try {
    const pkg = new URL('../../package.json', import.meta.url)
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

function logLine(r: RequestRecord): string {
  const ms = r.t.ended - r.t.received
  const status =
    r.status >= 400 || r.state === 'error'
      ? paint(c.red, String(r.status))
      : paint(c.green, String(r.status))
  const time = new Date(r.t.ended).toTimeString().slice(0, 8)
  const bits = [
    paint(c.dim, time),
    r.method.padEnd(4),
    r.path.padEnd(22),
    status,
    `${(ms / 1000).toFixed(2)}s`.padStart(7),
    `${r.tokens} tok`.padStart(8),
    paint(c.cyan, r.model),
  ]
  if (r.match) bits.push(paint(c.dim, `${r.match.source}:${r.match.name}`))
  if (r.fault) bits.push(paint(c.yellow, `fault:${r.fault}`))
  if (r.state === 'aborted') bits.push(paint(c.yellow, 'aborted'))
  if (r.error && r.state !== 'done') bits.push(paint(c.red, r.error))
  return bits.join(' ')
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      env: { type: 'string', short: 'e', default: '.env' },
      rules: { type: 'string', short: 'r' },
      host: { type: 'string', short: 'H' },
      port: { type: 'string', short: 'p' },
      parallel: { type: 'string', short: 'n' },
      preset: { type: 'string' },
      ttft: { type: 'string' },
      tps: { type: 'string' },
      seed: { type: 'string' },
      strict: { type: 'boolean' },
      mode: { type: 'string' },
      upstream: { type: 'string' },
      record: { type: 'boolean' },
      replay: { type: 'boolean' },
      json: { type: 'boolean' },
      quiet: { type: 'boolean', short: 'q' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (values.help) return void console.log(HELP)
  if (values.version) return void console.log(version())
  const cmd = positionals[0] ?? 'serve'

  if (cmd === 'presets') {
    for (const p of PRESETS)
      console.log(
        `${p.id.padEnd(10)} ${p.description}  (ttft ${p.values.ttftMs}ms, ${p.values.tps} tok/s)`,
      )
    return
  }

  const loaded = loadConfig(values.env, process.env)
  const rulesPath = values.rules ? path.resolve(values.rules) : loaded.rulesPath

  if (cmd === 'init') {
    const written = initFiles(loaded.envPath, rulesPath, values.force)
    if (!written.length)
      console.log('Nothing to do: .env and rules file exist (use --force to overwrite).')
    for (const f of written) console.log(`wrote ${f}`)
    return
  }

  let config: MockConfig = loaded.config
  if (values.preset) {
    const p = presetById(values.preset)
    if (!p) throw new Error(`unknown preset "${values.preset}" (see: elecmockolla presets)`)
    config = applyPreset(config, p)
  }
  const patch: Partial<Record<keyof MockConfig, unknown>> = {}
  if (values.host) patch.host = values.host
  if (values.port !== undefined) patch.port = values.port
  if (values.parallel) patch.numParallel = values.parallel
  if (values.ttft) patch.ttftMs = values.ttft
  if (values.tps) patch.tps = values.tps
  if (values.seed) patch.seed = values.seed
  if (values.strict) patch.strictModels = true
  if (values.mode) {
    if (!SERVER_MODES.includes(values.mode as never))
      throw new Error(`unknown mode "${values.mode}" (mock, proxy or mixed)`)
    patch.mode = values.mode
  }
  if (values.record) patch.record = true
  if (values.replay) patch.replay = true
  if (values.upstream) {
    if (!normalizeUpstream(values.upstream))
      throw new Error(`--upstream must be an http(s) URL, got "${values.upstream}"`)
    patch.upstream = values.upstream
  }
  config = patchConfig(config, patch)
  // Port 0 is "any free port": patchConfig clamps to 1..65535, so apply it here.
  if (values.port === '0') config.port = 0

  const rules = loadRules(rulesPath)

  if (cmd === 'check') {
    console.log(`.env:  ${loaded.envExists ? loaded.envPath : '(not found, using defaults)'}`)
    console.log(`rules: ${existsSync(rulesPath) ? rulesPath : '(not found, using built-in rules)'}`)
    console.log(`       ${rules.rules.length} rules, ${rules.keywords.length} keywords - OK`)
    return
  }
  if (cmd !== 'serve') throw new Error(`unknown command "${cmd}"\n\n${HELP}`)

  const recordingsPath = loaded.recordingsPath
  const recordings = loadRecordings(recordingsPath)
  const server = new MockServer({ config, rules, recordings })
  server.onRecorded = (r) => {
    recordings.push(r)
    saveRecordings(recordingsPath, recordings)
    if (!values.quiet)
      console.log(paint(c.red, `  ● recorded "${r.prompt.slice(0, 50)}" (${r.model})`))
  }
  if (!values.quiet)
    server.monitor.onFinish = (r) => {
      if (values.json) {
        const { requestBody: _b, ...rest } = r
        console.log(JSON.stringify(rest))
      } else console.log(logLine(r))
    }
  const url = await server.start()

  console.log(paint(c.bold, `elecmockolla ${version()}`) + paint(c.dim, ' - mock Ollama server'))
  console.log(`  listening  ${paint(c.cyan, url)}`)
  if (config.mode !== 'mock')
    console.log(
      `  mode       ${config.mode} → ${paint(c.cyan, config.upstream)}${config.mode === 'mixed' ? paint(c.dim, ' (rules and keywords answer first)') : ''}`,
    )
  console.log(
    `  settings   ${loaded.envExists ? loaded.envPath : paint(c.dim, '(no .env: defaults)')}`,
  )
  console.log(
    `  rules      ${existsSync(rulesPath) ? rulesPath : paint(c.dim, '(built-in rules)')}`,
  )
  console.log(
    `  speed      ttft ${config.ttftMs}ms, ${config.tps || '∞'} tok/s, ${config.numParallel} parallel, queue ${config.maxQueue}`,
  )
  console.log(`  models     ${config.models.join(', ')}`)
  if (config.record || config.replay || recordings.length)
    console.log(
      `  recordings ${recordings.length} in ${recordingsPath}${config.record ? paint(c.red, ' ● recording') : ''}${config.replay ? ' (played back)' : ''}`,
    )
  console.log(paint(c.dim, '  Ctrl+C to stop\n'))

  // Hot-reload the rules file when it changes on disk.
  if (existsSync(rulesPath)) {
    let timer: NodeJS.Timeout | undefined
    watch(rulesPath, () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        try {
          server.setRules(loadRules(rulesPath))
          console.log(paint(c.green, `  rules reloaded from ${path.basename(rulesPath)}`))
        } catch (e) {
          console.error(paint(c.red, `  rules not reloaded: ${e instanceof Error ? e.message : e}`))
        }
      }, 150)
    })
  }

  const shutdown = () => {
    void server.stop().then(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e: unknown) => {
  if (e instanceof RulesError) console.error(`rules error: ${e.message}`)
  else if (e instanceof Error && 'code' in e && e.code === 'EADDRINUSE')
    console.error(`port in use: ${e.message}\nIs a real Ollama already running? Try --port 11435.`)
  else console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
