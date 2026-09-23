import type { HostStatus, LoadGenStatus } from '../../shared/api.ts'
import type {
  ExportFormat,
  MockConfig,
  Preset,
  Recording,
  RequestRecord,
  RulesFile,
  Snapshot,
} from '../../shared/types.ts'
import { t, tOr } from './i18n.svelte.ts'

export type Page =
  | 'dashboard'
  | 'requests'
  | 'playground'
  | 'rules'
  | 'models'
  | 'chaos'
  | 'settings'

export type Theme = 'dark' | 'light'

const HISTORY = 500
const api = () => window.mockolla

function readTheme(): Theme {
  try {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** The one reactive store behind every page. */
class Store {
  ready = $state(false)
  status = $state<HostStatus>({ status: 'stopped', url: '', error: '', code: '' })
  notice = $state('')
  version = $state('')
  envPath = $state('')
  rulesPath = $state('')
  recordingsPath = $state('')
  recordings = $state.raw<Recording[]>([])
  config = $state.raw<MockConfig | null>(null)
  rules = $state.raw<RulesFile | null>(null)
  presets = $state.raw<Preset[]>([])
  /** Raw: replaced wholesale several times a second, never deep-proxied. */
  snapshot = $state.raw<Snapshot | null>(null)
  /** performance.now() when the snapshot arrived, to animate between snapshots. */
  snapshotAt = 0
  history = $state.raw<RequestRecord[]>([])
  loadGen = $state<LoadGenStatus>({ running: false, sent: 0, ok: 0, failed: 0, total: 0 })
  page = $state<Page>('dashboard')
  selected = $state<number | null>(null)
  theme = $state<Theme>(readTheme())
  toast = $state<{ text: string; kind: 'ok' | 'error' | 'info'; id: number } | null>(null)

  async init(): Promise<void> {
    const s = await api().getState()
    this.status = { status: s.status, url: s.url, error: s.error, code: s.code }
    this.notice = s.notice
    this.version = s.version
    this.envPath = s.envPath
    this.rulesPath = s.rulesPath
    this.recordingsPath = s.recordingsPath
    this.recordings = s.recordings
    this.config = s.config
    this.rules = s.rules
    this.presets = s.presets
    this.history = s.history
    if (s.snapshot) this.applySnapshot(s.snapshot)
    api().onSnapshot((snap) => this.applySnapshot(snap))
    api().onStatus((st) => {
      this.status = st
      if (st.status === 'error' && st.error) this.flash(this.errorText, 'error')
    })
    api().onLoadGen((st) => {
      this.loadGen = st
    })
    api().onRecordings((r) => {
      this.recordings = r
    })
    this.applyTheme()
    this.ready = true
  }

  private applySnapshot(s: Snapshot): void {
    this.snapshotAt = performance.now()
    this.snapshot = s
    if (s.finished.length) {
      const next = [...this.history, ...s.finished]
      this.history = next.length > HISTORY ? next.slice(-HISTORY) : next
    }
  }

  /** The server error in the UI language when its cause is known. */
  get errorText(): string {
    if (this.status.code === 'EADDRINUSE')
      return t('app.portInUse', { port: this.config?.port ?? '' })
    return this.status.error
  }

  setTheme(theme: Theme): void {
    this.theme = theme
    try {
      localStorage.setItem('theme', theme)
    } catch {
      // Storage may be unavailable; the theme still applies for this session.
    }
    this.applyTheme()
  }

  private applyTheme(): void {
    document.documentElement.dataset.theme = this.theme
    void api().setTheme(this.theme)
  }

  private toastSeq = 0
  flash(text: string, kind: 'ok' | 'error' | 'info' = 'ok'): void {
    const id = ++this.toastSeq
    this.toast = { text, kind, id }
    setTimeout(
      () => {
        if (this.toast?.id === id) this.toast = null
      },
      kind === 'error' ? 6000 : 2400,
    )
  }

  async saveConfig(
    patch: Partial<MockConfig>,
    message = t('common.settingsSaved'),
  ): Promise<boolean> {
    const r = await api().saveConfig(patch)
    if (!r.ok) {
      this.flash(r.error, 'error')
      return false
    }
    this.config = r.value
    if (message) this.flash(message)
    return true
  }

  async applyPreset(id: string): Promise<void> {
    const r = await api().applyPreset(id)
    if (!r.ok) return this.flash(r.error, 'error')
    this.config = r.value
    const label = this.presets.find((p) => p.id === id)?.label ?? id
    this.flash(t('common.presetApplied', { name: tOr(`preset.${id}.label`, label) }))
  }

  async saveRules(rules: RulesFile): Promise<boolean> {
    const r = await api().saveRules(rules)
    if (!r.ok) {
      this.flash(r.error, 'error')
      return false
    }
    this.rules = r.value
    this.notice = r.notice ?? ''
    this.flash(t('common.rulesSaved'))
    return true
  }

  /** Saves the given requests to a file main asks the user for. */
  async exportRequests(format: ExportFormat, ids: number[]): Promise<void> {
    const r = await api().exportRequests(format, ids)
    if (r.status === 'saved') this.flash(t('req.exported', { n: r.count, path: r.path }))
    else if (r.status === 'error') this.flash(r.error, 'error')
  }

  async deleteRecordings(ids: string[] | 'all'): Promise<void> {
    this.recordings = await api().deleteRecordings(ids)
    this.flash(ids === 'all' ? t('rec.deletedAll') : t('rec.deleted'))
  }

  async start(): Promise<void> {
    this.status = await api().start()
  }
  async stop(): Promise<void> {
    this.status = await api().stop()
  }
  async restart(): Promise<void> {
    this.status = await api().restart()
  }

  async resetStats(): Promise<void> {
    await api().resetStats()
    this.history = []
    this.selected = null
  }

  copy(text: string, what = t('common.copied')): void {
    void api().copy(text)
    this.flash(what, 'info')
  }

  open(page: Page, selected?: number): void {
    this.page = page
    if (selected !== undefined) this.selected = selected
  }
}

export const store = new Store()
