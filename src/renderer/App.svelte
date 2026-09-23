<script lang="ts">
import Icon from './components/Icon.svelte'
import { fmtUptime } from './lib/format.ts'
import { i18n, t } from './lib/i18n.svelte.ts'
import { type Page, store } from './lib/state.svelte.ts'
import Chaos from './pages/Chaos.svelte'
import Dashboard from './pages/Dashboard.svelte'
import Models from './pages/Models.svelte'
import Playground from './pages/Playground.svelte'
import Requests from './pages/Requests.svelte'
import Rules from './pages/Rules.svelte'
import Settings from './pages/Settings.svelte'

void store.init()

const NAV: { id: Page; icon: string; key: string }[] = [
  { id: 'dashboard', icon: 'dashboard', key: '1' },
  { id: 'requests', icon: 'list', key: '2' },
  { id: 'playground', icon: 'send', key: '3' },
  { id: 'rules', icon: 'rules', key: '4' },
  { id: 'models', icon: 'cube', key: '5' },
  { id: 'chaos', icon: 'bolt', key: '6' },
  { id: 'settings', icon: 'gear', key: '7' },
]

const st = $derived(store.status.status)
const snap = $derived(store.snapshot)
const active = $derived(snap?.active.filter((r) => r.state !== 'queued').length ?? 0)
const queued = $derived(snap?.queue.length ?? 0)
const pending = $derived(snap?.pendingFaults.length ?? 0)
const mode = $derived(store.config?.mode ?? 'mock')
const up = $derived(snap?.upstream ?? null)

function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return
  const item = NAV.find((n) => n.key === e.key)
  if (item) {
    e.preventDefault()
    store.page = item.id
  }
}
</script>

<svelte:window onkeydown={onKey} />

<div class="shell">
  <header class="titlebar">
    <div class="brand">
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path d="M4 18V8l4-4 4 4 4-4 4 4v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          <circle cx="9" cy="12" r="1.3" fill="currentColor" />
          <circle cx="15" cy="12" r="1.3" fill="currentColor" />
        </svg>
      </span>
      <b>elecmockolla</b>
      <span class="ver mono">v{store.version}</span>
    </div>
    <div class="status">
      <span class="dot" class:live={st === 'running'} class:warn={st === 'starting' || st === 'stopping'} class:bad={st === 'error'}></span>
      {#if st === 'running'}
        <button class="url mono" title={t('app.copyUrl')} onclick={() => store.copy(store.status.url, t('app.urlCopied'))}>
          <em>Ollama</em>{store.status.url}
          <Icon name="copy" size={12} />
        </button>
        <button class="url mono" title={t('app.copyOpenai')} onclick={() => store.copy(`${store.status.url}/v1`, t('app.urlCopied'))}>
          <em>OpenAI</em>{store.status.url}/v1
          <Icon name="copy" size={12} />
        </button>
        <span class="muted">{t('app.uptime', { time: fmtUptime((snap?.now ?? 0) - (snap?.startedAt ?? 0)) })}</span>
        {#if mode !== 'mock' && store.config}
          <button
            class="mode"
            class:bad={up !== null && up.checkedAt > 0 && !up.ok}
            title={up && !up.ok && up.checkedAt
              ? t('app.upstreamDown', { url: store.config.upstream, error: up.error })
              : t('app.upstreamOk', { version: up?.version ?? '', url: store.config.upstream })}
            onclick={() => (store.page = 'settings')}
          >
            <span class="dot" class:live={up?.ok} class:bad={up !== null && up.checkedAt > 0 && !up.ok}></span>
            {t(`mode.${mode}`)} → {store.config.upstream.replace(/^https?:\/\//, '')}
          </button>
          {#if store.config.record}
            <button class="rec" title={t('app.recTitle', { path: store.recordingsPath })} onclick={() => (store.page = 'rules')}>
              <span class="recdot"></span>{t('app.rec', { n: store.recordings.length })}
            </button>
          {/if}
        {/if}
      {:else}
        <span class="st">{t(`server.${st}`)}</span>
      {/if}
    </div>
    <div class="actions">
      {#if st === 'running'}
        <button class="btn sm" onclick={() => store.restart()}><Icon name="restart" size={13} />{t('app.restart')}</button>
        <button class="btn sm danger" onclick={() => store.stop()}><Icon name="power" size={13} />{t('app.stop')}</button>
      {:else}
        <button class="btn sm primary" disabled={st === 'starting' || st === 'stopping'} onclick={() => store.start()}>
          <Icon name="play" size={12} />{t('app.start')}
        </button>
      {/if}
    </div>
  </header>

  <nav class="sidebar">
    {#each NAV as n (n.id)}
      <button class="nav" class:on={store.page === n.id} onclick={() => (store.page = n.id)} title="{t(`nav.${n.id}`)} (Ctrl+{n.key})">
        <Icon name={n.icon} size={18} />
        <span>{t(`nav.${n.id}`)}</span>
        {#if n.id === 'dashboard' && active + queued > 0}
          <em class="badge">{active + queued}</em>
        {:else if n.id === 'chaos' && ((store.config?.faultRate ?? 0) > 0 || pending > 0)}
          <em class="badge warn">!</em>
        {/if}
      </button>
    {/each}
    <div class="spacer"></div>
    <button class="nav theme lang" onclick={() => (i18n.locale = i18n.locale === 'ja' ? 'en' : 'ja')} title={t('app.language')}>
      <Icon name="globe" size={16} />
      <span>{t('app.otherLanguage')}</span>
    </button>
    <button class="nav theme" onclick={() => store.setTheme(store.theme === 'dark' ? 'light' : 'dark')} title={t('app.toggleTheme')}>
      <Icon name={store.theme === 'dark' ? 'sun' : 'moon'} size={16} />
      <span>{store.theme === 'dark' ? t('app.light') : t('app.dark')}</span>
    </button>
  </nav>

  <main class="content">
    {#if store.status.status === 'error' && store.status.error}
      <div class="banner error">
        <b>{t('app.notRunning')}</b>
        {store.errorText}
        <button class="btn sm" onclick={() => (store.page = 'settings')}>{t('app.openSettings')}</button>
      </div>
    {/if}
    {#if store.notice}
      <div class="banner warn">{store.notice}</div>
    {/if}
    {#if store.ready}
      <div class="view">
        {#if store.page === 'dashboard'}
          <Dashboard />
        {:else if store.page === 'requests'}
          <Requests />
        {:else if store.page === 'playground'}
          <Playground />
        {:else if store.page === 'rules'}
          <Rules />
        {:else if store.page === 'models'}
          <Models />
        {:else if store.page === 'chaos'}
          <Chaos />
        {:else}
          <Settings />
        {/if}
      </div>
    {/if}
  </main>

  {#if store.toast}
    {#key store.toast.id}
      <div class="toast {store.toast.kind}">{store.toast.text}</div>
    {/key}
  {/if}
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 184px 1fr;
    grid-template-rows: var(--titlebar) 1fr;
    height: 100%;
  }
  .titlebar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 150px 0 14px;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    -webkit-app-region: drag;
  }
  .titlebar button {
    -webkit-app-region: no-drag;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 170px;
  }
  .logo {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .ver {
    color: var(--muted);
    font-size: 10px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .status > * {
    flex-shrink: 0;
  }
  .url {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--line-2);
    background: var(--panel);
    border-radius: 6px;
    height: 24px;
    padding: 0 8px;
    cursor: pointer;
    color: var(--accent);
  }
  .url:hover {
    border-color: var(--accent);
  }
  .url em {
    font: 600 10px var(--font);
    font-style: normal;
    color: var(--muted);
  }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 9px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--violet) 50%, var(--line-2));
    background: color-mix(in srgb, var(--violet) 12%, transparent);
    color: var(--violet);
    font: 600 11px var(--mono);
    cursor: pointer;
  }
  .rec {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 9px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--red) 50%, var(--line-2));
    background: var(--red-soft);
    color: var(--red);
    font: 600 11px var(--mono);
    cursor: pointer;
  }
  .recdot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--red);
    animation: recblink 1.4s ease-in-out infinite;
  }
  @keyframes recblink {
    50% {
      opacity: 0.25;
    }
  }
  .mode.bad {
    border-color: var(--red);
    background: var(--red-soft);
    color: var(--red);
  }
  .st {
    text-transform: capitalize;
    color: var(--text-2);
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px;
    border-right: 1px solid var(--line);
    background: var(--bg);
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
    position: relative;
  }
  .nav:hover {
    background: var(--panel);
    color: var(--text);
  }
  .nav.on {
    background: var(--panel-2);
    color: var(--text);
  }
  .nav.on::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }
  .nav span {
    flex: 1;
  }
  .badge {
    font-style: normal;
    font: 600 10px var(--mono);
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .badge.warn {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .spacer {
    flex: 1;
  }
  .theme {
    font-size: 12px;
  }
  .content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-2);
  }
  .view {
    flex: 1;
    min-height: 0;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 12px;
    border-bottom: 1px solid var(--line);
  }
  .banner.error {
    background: var(--red-soft);
    color: var(--red);
  }
  .banner.warn {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .banner .btn {
    margin-left: auto;
  }
  .toast {
    position: fixed;
    right: 18px;
    bottom: 18px;
    max-width: 480px;
    padding: 10px 14px;
    border-radius: 8px;
    background: var(--panel-3);
    border: 1px solid var(--line-2);
    box-shadow: var(--shadow);
    animation: slide 0.18s ease-out;
    z-index: 100;
  }
  .toast.ok {
    border-color: color-mix(in srgb, var(--green) 50%, var(--line-2));
  }
  .toast.error {
    border-color: var(--red);
    color: var(--red);
  }
  @keyframes slide {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
