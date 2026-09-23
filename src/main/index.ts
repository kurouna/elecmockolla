import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  shell,
} from 'electron'
import { applyPreset, PRESETS, patchConfig, presetById } from '../core/config.ts'
import { Engine } from '../core/engine.ts'
import { EXPORT_FORMATS, exportRequests } from '../core/export.ts'
import {
  initFiles,
  loadConfig,
  loadRecordings,
  loadRules,
  saveEnv,
  saveRecordings,
  saveRules,
  writeAtomic,
} from '../core/files.ts'
import { RecordingStore } from '../core/recordings.ts'
import { defaultRules, FAULT_MODES, normalizeRules } from '../core/rules.ts'
import type {
  AppState,
  ExportResult,
  LoadGenOptions,
  PlaygroundApi,
  PlaygroundRequest,
  SaveResult,
} from '../shared/api.ts'
import { CH } from '../shared/channels.ts'
import type { ExportFormat, FaultMode, MockConfig, Recording, RulesFile } from '../shared/types.ts'
import { capturePages } from './capture.ts'
import { LoadGenerator, Playground } from './client.ts'
import { ServerHost } from './host.ts'

declare const __APP_VERSION__: string

const PRELOAD = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
/** The window and taskbar icon, rendered from build/icon.svg by `npm run gen:icon`. */
const ICON = path.join(app.getAppPath(), 'resources', 'icons', 'icon.png')
const RENDERER_HTML = fileURLToPath(new URL('../renderer/index.html', import.meta.url))

/**
 * Where .env and rules.json live: MOCKOLLA_HOME, else the project folder in
 * development (so `npm start` and `npm run serve` share one .env), else the
 * user data folder of the packaged app.
 */
const HOME = process.env.MOCKOLLA_HOME ?? (app.isPackaged ? app.getPath('userData') : process.cwd())
const ENV_PATH = path.join(HOME, '.env')

let win: BrowserWindow | null = null
const host = new ServerHost()
const playground = new Playground()
const loadGen = new LoadGenerator()

let config: MockConfig
let rulesPath: string
let rules: RulesFile
/** A rules file that failed to parse at startup: shown, never overwritten silently. */
let rulesError = ''
let recordingsPath: string
let recordings: Recording[] = []
/** Same index as the server's, for the playground's "will match". */
let recordingStore = new RecordingStore()
/** A recordings file that failed to parse: never overwritten, so nothing in it is lost. */
let recordingsError = ''

function readRecordings(): void {
  try {
    recordings = loadRecordings(recordingsPath)
    recordingsError = ''
  } catch (e) {
    recordings = []
    recordingsError = `${path.basename(recordingsPath)}: ${e instanceof Error ? e.message : e} (recording is paused until it is fixed)`
  }
  recordingStore = new RecordingStore(recordings)
}

let saveTimer: NodeJS.Timeout | undefined
/** Saves recordings.json a moment after the last change, so a burst of replies is one write. */
function saveRecordingsSoon(): void {
  if (recordingsError) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      saveRecordings(recordingsPath, recordings)
    } catch (e) {
      console.error(`could not save ${recordingsPath}:`, e)
    }
  }, 300)
}

const notice = () => [rulesError, recordingsError].filter(Boolean).join(' / ')

function loadFromDisk(): void {
  const loaded = loadConfig(ENV_PATH, process.env)
  initFiles(loaded.envPath, loaded.rulesPath)
  config = loaded.config
  rulesPath = loaded.rulesPath
  recordingsPath = loaded.recordingsPath
  readRecordings()
  try {
    rules = loadRules(rulesPath)
    rulesError = ''
  } catch (e) {
    rules = defaultRules()
    rulesError = `${path.basename(rulesPath)}: ${e instanceof Error ? e.message : e} (using built-in rules until you save)`
  }
}

const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// --- input checks (the renderer is untrusted) -----------------------------

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max = 100_000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const APIS: PlaygroundApi[] = ['chat', 'generate', 'openai']

function toPlayground(v: unknown): PlaygroundRequest {
  const o = isObj(v) ? v : {}
  return {
    api: APIS.includes(o.api as PlaygroundApi) ? (o.api as PlaygroundApi) : 'chat',
    model: text(o.model, 200) || 'llama3.2:3b',
    prompt: text(o.prompt),
    system: text(o.system),
    stream: o.stream !== false,
    think: o.think === true,
    json: o.json === true,
  }
}

function toLoadGen(v: unknown): LoadGenOptions {
  const o = isObj(v) ? v : {}
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
  return {
    concurrency: n(o.concurrency, 8),
    total: n(o.total, 50),
    api: APIS.includes(o.api as PlaygroundApi) ? (o.api as PlaygroundApi) : 'chat',
    randomModels: o.randomModels !== false,
  }
}

// --- actions -----------------------------------------------------------------

async function startServer() {
  return host.start(config, rules, recordings)
}

/** A rules or recordings path from the page: a .json file, resolved against HOME. */
function jsonPath(p: string, what: string): string {
  const abs = path.resolve(HOME, p)
  if (path.extname(abs).toLowerCase() !== '.json')
    throw new Error(`the ${what} file must be a .json file`)
  return abs
}

async function applyConfig(next: MockConfig): Promise<SaveResult<MockConfig>> {
  try {
    const needsRestart = next.host !== config.host || next.port !== config.port
    // A moved file is read (and so validated) first: if it is not a rules or recordings
    // file, nothing changes, and a later save cannot overwrite what the user pointed at.
    const moved = {
      rules:
        next.rulesPath !== config.rulesPath
          ? (() => {
              const p = jsonPath(next.rulesPath, 'rules')
              return { path: p, rules: loadRules(p) }
            })()
          : null,
      recordings:
        next.recordingsPath !== config.recordingsPath
          ? (() => {
              const p = jsonPath(next.recordingsPath, 'recordings')
              return { path: p, recordings: loadRecordings(p) }
            })()
          : null,
    }
    saveEnv(ENV_PATH, next)
    config = next
    if (moved.rules) {
      rulesPath = moved.rules.path
      rules = moved.rules.rules
      rulesError = ''
      initFiles(ENV_PATH, rulesPath)
      host.setRules(rules)
    }
    if (moved.recordings) {
      recordingsPath = moved.recordings.path
      recordings = moved.recordings.recordings
      recordingsError = ''
      recordingStore = new RecordingStore(recordings)
      host.setRecordings(recordings)
      send(CH.recordings, recordings)
    }
    if (host.running && needsRestart) {
      await host.stop()
      await startServer()
    } else host.setConfig(config)
    return { ok: true, value: config }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function registerIpc(): void {
  const handle = (ch: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    ipcMain.handle(ch, fn)

  handle(
    CH.getState,
    (): AppState => ({
      ...host.getStatus(),
      notice: notice(),
      version: __APP_VERSION__,
      envPath: ENV_PATH,
      rulesPath,
      recordingsPath,
      config,
      rules,
      recordings,
      presets: [...PRESETS],
      history: host.history,
      snapshot: host.snapshot,
    }),
  )
  handle(CH.start, () => startServer())
  handle(CH.stop, () => host.stop())
  handle(CH.restart, async () => {
    await host.stop()
    return startServer()
  })
  handle(CH.saveConfig, (_e, patch) => {
    if (!isObj(patch)) return { ok: false, error: 'expected an object' }
    return applyConfig(patchConfig(config, patch))
  })
  handle(CH.applyPreset, (_e, id) => {
    const p = presetById(text(id, 40))
    if (!p) return { ok: false, error: 'unknown preset' }
    return applyConfig(applyPreset(config, p))
  })
  handle(CH.saveRules, (_e, v): SaveResult<RulesFile> => {
    try {
      const next = normalizeRules(v)
      saveRules(rulesPath, next)
      rules = next
      rulesError = ''
      host.setRules(rules)
      return { ok: true, value: rules, notice: notice() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  handle(CH.defaultRules, () => defaultRules())
  handle(CH.deleteRecordings, (_e, ids) => {
    if (ids === 'all') recordings = []
    else if (Array.isArray(ids)) {
      const drop = new Set(ids.filter((x): x is string => typeof x === 'string'))
      recordings = recordings.filter((r) => !drop.has(r.id))
    } else return recordings
    recordingStore = new RecordingStore(recordings)
    host.setRecordings(recordings)
    saveRecordingsSoon()
    return recordings
  })
  handle(CH.testRules, (_e, input, draft) => {
    const i = isObj(input) ? input : {}
    let r = rules
    if (draft !== undefined) {
      try {
        r = normalizeRules(draft)
      } catch (e) {
        return {
          match: { source: 'fallback', name: '(invalid rules)' },
          text: '',
          thinking: '',
          toolCalls: [],
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }
    // The playground (no draft) sees what the server would do: a recording answers first.
    if (draft === undefined && config.replay && config.mode !== 'proxy') {
      const prompt = text(i.prompt)
      const system = text(i.system)
      const hit = recordingStore.find(
        text(i.model, 200) || 'llama3.2:3b',
        [system, prompt].filter(Boolean).join('\n'),
      )
      if (hit)
        return {
          match: { source: 'recording', id: hit.id, name: hit.prompt.slice(0, 60) || hit.id },
          text: hit.chunks.join(''),
          thinking: i.think === true ? hit.thinking.join('') : '',
          toolCalls: hit.toolCalls,
        }
    }
    return new Engine(r, { seed: config.seed }).test({
      prompt: text(i.prompt),
      system: text(i.system),
      model: text(i.model, 200),
      think: i.think === true,
    })
  })
  handle(CH.injectFault, (_e, mode, count) => {
    if (!FAULT_MODES.includes(mode as FaultMode)) return
    host.injectFault(
      mode as FaultMode,
      typeof count === 'number' ? Math.max(1, Math.min(count, 1000)) : 1,
    )
  })
  handle(CH.clearFaults, () => host.clearFaults())
  handle(CH.resetStats, () => host.resetStats())
  handle(CH.playground, (_e, req) => {
    const r = toPlayground(req)
    if (!host.running) return -1
    return playground.send(host.serverUrl, r, (ev) => send(CH.playgroundEvent, ev))
  })
  handle(CH.cancelPlayground, (_e, id) => {
    if (typeof id === 'number') playground.cancel(id)
  })
  handle(CH.loadGen, (_e, opts) => {
    if (!host.running) return
    const models = host.snapshot?.models ?? config.models
    void loadGen.run(host.serverUrl, models, toLoadGen(opts), (s) => send(CH.loadGenStatus, s))
  })
  handle(CH.stopLoadGen, () => loadGen.stop())
  handle(CH.exportRequests, async (_e, format, ids): Promise<ExportResult> => {
    if (!EXPORT_FORMATS.includes(format as ExportFormat))
      return { status: 'error', error: 'unknown format' }
    const wanted = new Set(
      (Array.isArray(ids) ? ids : [])
        .filter((x): x is number => Number.isInteger(x))
        .slice(0, 5000),
    )
    const all = [...host.history, ...(host.snapshot?.active ?? [])]
    const records = all.filter((r) => wanted.has(r.id)).sort((a, b) => a.id - b.id)
    if (!records.length) return { status: 'error', error: 'no requests to export' }
    const f = format as ExportFormat
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const opts = {
      title: 'elecmockolla',
      defaultPath: path.join(app.getPath('downloads'), `elecmockolla-requests-${stamp}.${f}`),
      filters: [
        f === 'har' ? { name: 'HAR', extensions: ['har'] } : { name: 'JSON', extensions: ['json'] },
      ],
    }
    const pick = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (pick.canceled || !pick.filePath) return { status: 'canceled' }
    try {
      const body = exportRequests(f, records, {
        url: host.serverUrl || host.getStatus().url,
        version: __APP_VERSION__,
        mode: config.mode,
      })
      writeAtomic(pick.filePath, body)
      return { status: 'saved', path: pick.filePath, count: records.length }
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e.message : String(e) }
    }
  })
  handle(CH.openFolder, () => {
    void shell.openPath(HOME)
  })
  handle(CH.copy, (_e, t) => clipboard.writeText(text(t, 1_000_000)))
  handle(CH.setTheme, (_e, theme) => {
    if (!win || process.platform === 'darwin') return
    const light = theme === 'light'
    win.setTitleBarOverlay({
      color: light ? '#f3f6fa' : '#0a0e14',
      symbolColor: light ? '#3d4c5c' : '#9fb3c8',
    })
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    title: 'elecmockolla',
    icon: ICON,
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0a0e14',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 12 } }
      : { titleBarOverlay: { color: '#0a0e14', symbolColor: '#9fb3c8', height: 40 } }),
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Screenshot mode must keep painting even when the window is behind others.
      backgroundThrottling: !process.env.MOCKOLLA_CAPTURE,
    },
  })
  win.once('ready-to-show', () => win?.show())
  // Links never open inside the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // MOCKOLLA_LANG=en|ja overrides the UI language (the default follows the OS), e.g. for screenshots.
  const lang = process.env.MOCKOLLA_LANG
  const query: Record<string, string> = lang === 'en' || lang === 'ja' ? { lang } : {}
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    const url = new URL(devUrl)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    void win.loadURL(url.toString())
  } else void win.loadFile(RENDERER_HTML, { query })
  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(async () => {
  loadFromDisk()
  host.on('status', (s) => send(CH.status, s))
  host.on('snapshot', (s) => send(CH.snapshot, s))
  host.on('recorded', (r: Recording) => {
    if (recordingsError || !recordingStore.add(r)) return
    recordings = [...recordings, r]
    saveRecordingsSoon()
    send(CH.recordings, recordings)
  })
  registerIpc()
  createWindow()
  // Start right away: `npm start` should give a working mock with no clicks.
  if (process.env.MOCKOLLA_NO_AUTOSTART !== '1') await startServer()

  const captureDir = process.env.MOCKOLLA_CAPTURE
  if (captureDir && win) {
    const w = win
    const traffic = () => {
      if (!host.running) return
      const models = host.snapshot?.models ?? config.models
      const opts = { concurrency: 7, total: 80, api: 'chat' as const, randomModels: true }
      void loadGen.run(host.serverUrl, models, opts, (s) => send(CH.loadGenStatus, s))
    }
    w.once('ready-to-show', () => {
      void capturePages(w, path.resolve(captureDir), traffic).finally(() => app.quit())
    })
  }
})

app.on('window-all-closed', () => {
  loadGen.stop()
  void host.stop().then(() => app.quit())
})
