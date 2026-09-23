<script lang="ts">
import { onDestroy } from 'svelte'
import type { PlaygroundApi, PlaygroundEvent } from '../../shared/api.ts'
import type { TestResult } from '../../shared/types.ts'
import Icon from '../components/Icon.svelte'
import { fmtMs, matchLabel } from '../lib/format.ts'
import { t } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

const api = window.mockolla

let kind = $state<PlaygroundApi>('chat')
let model = $state(store.config?.models[0] ?? 'llama3.2:3b')
let system = $state('')
let prompt = $state('hello, who are you?')
let stream = $state(true)
let think = $state(false)
let json = $state(false)
let showRaw = $state(false)

let running = $state<number | null>(null)
let content = $state('')
let thinking = $state('')
let raw = $state<string[]>([])
let status = $state(0)
let error = $state('')
let t0 = 0
let firstAt = $state(0)
let doneMs = $state(0)
let chunks = $state(0)
/** The reply outgrew MAX_TEXT and its start is no longer shown. */
let clipped = $state(false)
let cancelled = $state(false)
let preview = $state<TestResult | null>(null)
/** Only the newest preview is shown; an older one arriving late is dropped. */
let previewSeq = 0

/** Text kept on screen: a reply that never ends shows its latest part, not all of it. */
const MAX_TEXT = 40_000
const keepTail = (s: string) => (s.length > MAX_TEXT ? s.slice(-MAX_TEXT) : s)

const QUICK = [
  'hello',
  'これは何ですか？',
  'my name is Kurouna',
  'weather in Tokyo',
  'What is Kubernetes?',
  'ReactとVueの違いは？',
  'Pythonでファイル一覧を出す関数を書いて',
  'Summarize this article',
  'おすすめの本を教えて',
  '/json',
  '/code',
  '/echo any text',
  '/markdown',
  '/unicode',
  '/long 300',
  '/empty',
  '/tool search {"q": "cats"}',
  '/slow',
  '/error',
  '/error 429',
  '/cut',
]

const models = $derived(store.snapshot?.models ?? store.config?.models ?? [])
const mode = $derived(store.config?.mode ?? 'mock')
/** "llama3.2" and "llama3.2:latest" are the same model, as in Ollama. */
const norm = (n: string) => (n.trim().includes(':') ? n.trim() : `${n.trim()}:latest`)
/** In mixed mode the mock answers a model only it has, even with nothing matching. */
const mockOnly = $derived.by(() => {
  const up = store.snapshot?.upstream
  const own = store.config?.models ?? []
  const m = norm(model)
  return !!up?.ok && !up.models.some((x) => norm(x) === m) && own.some((x) => norm(x) === m)
})
/** Proxy mode, or mixed mode with nothing matching: the real Ollama answers. */
const toOllama = $derived(
  mode === 'proxy' || (mode === 'mixed' && preview?.match.source === 'fallback' && !mockOnly),
)

$effect(() => {
  const off = api.onPlayground((e: PlaygroundEvent) => {
    if (e.id !== running) return
    switch (e.type) {
      case 'status':
        status = e.status
        break
      case 'chunk':
        if (!firstAt && (e.content || e.thinking)) firstAt = performance.now()
        if (e.content) {
          clipped ||= content.length + e.content.length > MAX_TEXT
          content = keepTail(content + e.content)
        }
        if (e.thinking) thinking = keepTail(thinking + e.thinking)
        chunks += e.raw.length
        if (raw.length < 400) raw.push(...e.raw.slice(0, 400 - raw.length))
        break
      case 'done':
        doneMs = e.ms
        if (!stream) raw = [e.raw]
        running = null
        break
      case 'error':
        // main says "cancelled" when the user pressed Cancel: that is not a failure.
        error = e.message === 'cancelled' ? '' : e.message
        cancelled = e.message === 'cancelled'
        running = null
        break
    }
  })
  return off
})

// Which rule would answer, updated as you type.
$effect(() => {
  const input = { prompt, system, model, think }
  const seq = ++previewSeq
  const t = setTimeout(async () => {
    const r = await api.testRules(input)
    if (seq === previewSeq) preview = r
  }, 150)
  return () => clearTimeout(t)
})

/** Between asking main to send and getting the request id back. */
let starting = false
let gone = false

async function send() {
  if (running !== null || starting) return
  starting = true
  content = ''
  thinking = ''
  raw = []
  status = 0
  error = ''
  firstAt = 0
  doneMs = 0
  chunks = 0
  clipped = false
  cancelled = false
  t0 = performance.now()
  const id = await api.playground({ api: kind, model, prompt, system, stream, think, json })
  starting = false
  if (id < 0) {
    error = t('pg.notRunning')
    return
  }
  if (gone) {
    void api.cancelPlayground(id)
    return
  }
  running = id
}

onDestroy(() => {
  gone = true
  if (running !== null) void api.cancelPlayground(running)
})

function cancel() {
  if (running !== null) void api.cancelPlayground(running)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void send()
  }
}

const ttftMs = $derived(firstAt ? firstAt - t0 : 0)
</script>

<div class="wrap">
  <section class="card form">
    <div class="card-head"><h3>{t('pg.request')}</h3></div>
    <div class="card-body col">
      <div class="seg">
        <button class:on={kind === 'chat'} onclick={() => (kind = 'chat')}>/api/chat</button>
        <button class:on={kind === 'generate'} onclick={() => (kind = 'generate')}>/api/generate</button>
        <button class:on={kind === 'openai'} onclick={() => (kind = 'openai')}>/v1/chat/completions</button>
      </div>
      <label class="field">
        <span>{t('common.model')}</span>
        <input class="input mono" list="pg-models" bind:value={model} />
        <datalist id="pg-models">
          {#each models as m (m)}<option value={m}></option>{/each}
        </datalist>
      </label>
      <label class="field">
        <span>{t('pg.system')}</span>
        <textarea class="textarea" rows="2" bind:value={system} placeholder={t('pg.optional')}></textarea>
      </label>
      <label class="field">
        <span>{t('common.prompt')} <span class="muted">{t('pg.sendHint')}</span></span>
        <textarea class="textarea" rows="5" bind:value={prompt} onkeydown={onKey}></textarea>
      </label>
      <div class="quick">
        {#each QUICK as q (q)}
          <button class="chip qchip" onclick={() => (prompt = q)}>{q}</button>
        {/each}
      </div>
      <div class="row wrapline">
        <label class="check"><input type="checkbox" bind:checked={stream} />stream</label>
        <label class="check"><input type="checkbox" bind:checked={think} />think</label>
        <label class="check"><input type="checkbox" bind:checked={json} />{t('pg.jsonFormat')}</label>
      </div>
      {#if preview}
        <div class="preview">
          <span class="muted">{t('pg.willMatch')}</span>
          {#if toOllama}
            <span class="chip accent">{t('pg.toOllama')} ({store.config?.upstream.replace(/^https?:\/\//, '')})</span>
          {:else}
            <span class="chip violet">{matchLabel(preview.match)}</span>
            {#if preview.error}<span class="chip red">{preview.error}</span>{/if}
          {/if}
        </div>
      {/if}
      <div class="row">
        {#if running !== null}
          <button class="btn danger" onclick={cancel}><Icon name="stop" size={13} />{t('pg.cancel')}</button>
        {:else}
          <button class="btn primary send" onclick={send} disabled={store.status.status !== 'running'}><Icon name="send" size={14} />{t('pg.send')}</button>
        {/if}
        {#if store.status.status !== 'running'}<span class="muted">{t('pg.startFirst')}</span>{/if}
      </div>
    </div>
  </section>

  <section class="card out">
    <div class="card-head">
      <h3>{t('pg.response')}</h3>
      {#if status}<span class="chip {status < 400 ? 'green' : 'red'}">{status}</span>{/if}
      {#if running !== null}<span class="chip accent">{t('pg.streaming')}</span>{/if}
      <span class="grow"></span>
      <div class="seg">
        <button class:on={!showRaw} onclick={() => (showRaw = false)}>{t('pg.text')}</button>
        <button class:on={showRaw} onclick={() => (showRaw = true)}>{t('pg.wire')}</button>
      </div>
    </div>
    <div class="metrics">
      <div><em>TTFT</em><b>{ttftMs ? fmtMs(ttftMs) : '–'}</b></div>
      <div><em>{t('pg.chunks')}</em><b>{chunks}</b></div>
      <div><em>{t('pg.total')}</em><b>{doneMs ? fmtMs(doneMs) : running !== null ? '…' : '–'}</b></div>
      <div><em>{t('pg.rate')}</em><b>{doneMs && firstAt && chunks > 1 ? `${(chunks / ((doneMs - ttftMs) / 1000 || 1)).toFixed(1)}/s` : '–'}</b></div>
    </div>
    <div class="card-body body">
      {#if error}<div class="err mono">{error}</div>{/if}
      {#if cancelled}<div class="muted cancelled">{t('pg.cancelled')}</div>{/if}
      {#if showRaw}
        <pre class="raw">{raw.join('\n')}</pre>
      {:else}
        {#if thinking}<pre class="think">{thinking}</pre>{/if}
        {#if clipped}<div class="muted clipped">{t('pg.clipped', { n: MAX_TEXT.toLocaleString() })}</div>{/if}
        <pre class="text">{content}{#if running !== null}<span class="caret"></span>{/if}</pre>
        {#if !content && !thinking && !error && running === null}
          <div class="empty">{t('pg.empty')}</div>
        {/if}
      {/if}
    </div>
  </section>
</div>

<style>
  .wrap {
    display: grid;
    grid-template-columns: minmax(340px, 0.9fr) minmax(0, 1.2fr);
    gap: 12px;
    height: 100%;
    padding: 16px 18px;
  }
  .form,
  .out {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .qchip {
    border: 0;
    cursor: pointer;
    font-family: var(--mono);
    font-weight: 500;
  }
  .qchip:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .wrapline {
    gap: 16px;
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    flex-wrap: wrap;
  }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    margin: 12px 14px 0;
    border-radius: 8px;
    overflow: hidden;
    background: var(--line);
  }
  .metrics div {
    background: var(--panel-2);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
  }
  .metrics em {
    font-style: normal;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
  }
  .metrics b {
    font: 600 16px var(--mono);
  }
  .body {
    flex: 1;
    overflow: auto;
  }
  .text {
    font-size: 13.5px;
    line-height: 1.7;
    font-family: var(--font);
  }
  .cancelled {
    font-size: 12px;
    margin-bottom: 8px;
  }
  .clipped {
    font-size: 11px;
    margin-bottom: 6px;
  }
  .think {
    color: var(--blue);
    border-left: 2px solid var(--blue);
    padding-left: 10px;
    margin-bottom: 12px;
    opacity: 0.85;
  }
  .raw {
    font-size: 11px;
    color: var(--text-2);
  }
  .err {
    color: var(--red);
    background: var(--red-soft);
    padding: 6px 10px;
    border-radius: 6px;
    margin-bottom: 10px;
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 15px;
    margin-left: 1px;
    vertical-align: -2px;
    background: var(--accent);
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
</style>
