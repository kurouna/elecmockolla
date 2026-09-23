<script lang="ts">
import type { RequestRecord } from '../../shared/types.ts'
import Icon from '../components/Icon.svelte'
import {
  API_LABEL,
  curlFor,
  duration,
  fmtClock,
  fmtMs,
  matchLabel,
  rate,
  statusChip,
  ttft,
} from '../lib/format.ts'
import { t } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

let filter = $state('')
let only = $state<'all' | 'ok' | 'errors' | 'faults'>('all')
let tab = $state<'response' | 'request' | 'timing'>('response')

/** Finished requests plus the ones still running, newest first. */
const all = $derived.by(() => {
  const act = store.snapshot?.active ?? []
  const ids = new Set(act.map((r) => r.id))
  return [...store.history.filter((r) => !ids.has(r.id)), ...act].reverse()
})

const rows = $derived.by(() => {
  const f = filter.trim().toLowerCase()
  return all.filter((r) => {
    if (only === 'ok' && (r.state !== 'done' || r.status >= 400)) return false
    if (only === 'errors' && r.state !== 'error' && r.status < 400) return false
    if (only === 'faults' && !r.fault) return false
    if (!f) return true
    const hay =
      `${r.id} ${r.model} ${r.path} ${r.match?.name ?? ''} ${JSON.stringify(r.requestBody)} ${r.responseText}`.toLowerCase()
    return hay.includes(f)
  })
})

const sel = $derived<RequestRecord | undefined>(
  all.find((r) => r.id === store.selected) ?? undefined,
)

/** The prompt a human would recognise: last user message or the generate prompt. */
function promptOf(r: RequestRecord): string {
  const b = r.requestBody as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return ''
  if (typeof b.prompt === 'string') return b.prompt
  if (Array.isArray(b.messages)) {
    const m = [...b.messages].reverse().find((x) => (x as { role?: string }).role === 'user') as
      | { content?: unknown }
      | undefined
    return typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '')
  }
  if (b.input !== undefined) return JSON.stringify(b.input)
  return ''
}

function phases(r: RequestRecord) {
  const end = r.t.ended || store.snapshot?.now || Date.now()
  const total = Math.max(1, end - r.t.received)
  const started = r.t.started || end
  const first = r.t.firstToken || end
  const p = [
    { k: t('phase.queue'), ms: started - r.t.received, cls: 'q' },
    { k: t('phase.load'), ms: r.loadMs, cls: 'l' },
    { k: t('phase.firstToken'), ms: Math.max(0, first - started - r.loadMs), cls: 'w' },
    { k: t('phase.stream'), ms: r.t.firstToken ? end - r.t.firstToken : 0, cls: 's' },
  ]
  return { total, p }
}
</script>

<div class="wrap">
  <section class="left card">
    <div class="toolbar">
      <input class="input" placeholder={t('req.filter')} bind:value={filter} />
      <div class="seg">
        {#each ['all', 'ok', 'errors', 'faults'] as const as o (o)}
          <button class:on={only === o} onclick={() => (only = o)}>{t(`req.only.${o}`)}</button>
        {/each}
      </div>
      <div class="export" title={t('req.exportTitle', { n: rows.length })}>
        <Icon name="save" size={13} />
        {#each ['json', 'har'] as const as f (f)}
          <button class="btn sm ghost" disabled={!rows.length} onclick={() => store.exportRequests(f, rows.map((r) => r.id))}
            >{f.toUpperCase()}</button
          >
        {/each}
      </div>
      <button class="btn sm ghost" title={t('req.clear')} onclick={() => store.resetStats()}><Icon name="trash" size={13} /></button>
    </div>
    <div class="table">
      <table class="grid">
        <thead>
          <tr>
            <th>#</th><th>{t('req.col.time')}</th><th>{t('req.col.status')}</th><th>API</th><th>{t('req.col.model')}</th>
            <th>{t('req.col.matched')}</th><th class="r">TTFT</th><th class="r">{t('req.col.total')}</th><th class="r">{t('req.col.tok')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows.slice(0, 300) as r (r.id)}
            {@const c = statusChip(r)}
            <tr class="clickable" class:selected={r.id === store.selected} onclick={() => (store.selected = r.id)}>
              <td class="mono muted">{r.id}</td>
              <td class="mono">{fmtClock(r.t.received)}</td>
              <td><span class="chip {c.cls}">{c.label}</span>{#if r.fault}<span class="chip red f">⚡</span>{/if}</td>
              <td class="mono muted">{API_LABEL[r.api]}</td>
              <td class="mono ell">{r.model}</td>
              <td class="ell muted">{r.match ? (r.match.source === 'upstream' ? matchLabel(r.match) : r.match.name) : ''}</td>
              <td class="mono r">{Number.isFinite(ttft(r)) ? fmtMs(ttft(r)) : '–'}</td>
              <td class="mono r">{fmtMs(duration(r, store.snapshot?.now))}</td>
              <td class="mono r">{r.tokens}</td>
            </tr>
          {:else}
            <tr><td colspan="9"><div class="empty">{filter || only !== 'all' ? t('req.noMatch') : t('common.noRequests')}</div></td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="right card">
    {#if sel}
      {@const c = statusChip(sel)}
      {@const ph = phases(sel)}
      <div class="dhead">
        <div class="row">
          <h2>#{sel.id}</h2>
          <span class="chip {c.cls}">{c.label}</span>
          <span class="mono">{sel.method} {sel.path}</span>
          <span class="grow"></span>
          <button class="btn sm" onclick={() => store.copy(curlFor(sel, store.status.url || 'http://127.0.0.1:11434'), t('req.curlCopied'))}>
            <Icon name="copy" size={12} />curl
          </button>
        </div>
        <div class="facts">
          <span><em>{t('req.fact.model')}</em>{sel.model}</span>
          <span><em>{t('req.fact.stream')}</em>{sel.stream ? t('req.yes') : t('req.no')}</span>
          <span><em>{t('req.fact.slot')}</em>{sel.slot === null ? '–' : sel.slot + 1}</span>
          <span><em>{t('req.fact.promptTok')}</em>{sel.promptTokens}</span>
          <span><em>{t('req.fact.outputTok')}</em>{sel.tokens}</span>
          <span><em>{t('req.fact.rate')}</em>{rate(sel, store.snapshot?.now).toFixed(1)} tok/s</span>
          {#if sel.match}<span><em>{t('req.fact.matched')}</em>{matchLabel(sel.match)}</span>{/if}
          {#if sel.fault}<span class="bad"><em>{t('req.fact.fault')}</em>{sel.fault}</span>{/if}
        </div>
        <div class="phasebar" title={t('req.whereTime')}>
          {#each ph.p as p (p.k)}
            {#if p.ms > 0}<i class={p.cls} style:flex-grow={p.ms / ph.total}></i>{/if}
          {/each}
        </div>
        {#if sel.error}<div class="err mono">{sel.error}</div>{/if}
        <div class="seg tabs">
          <button class:on={tab === 'response'} onclick={() => (tab = 'response')}>{t('req.tab.response')}</button>
          <button class:on={tab === 'request'} onclick={() => (tab = 'request')}>{t('req.tab.request')}</button>
          <button class:on={tab === 'timing'} onclick={() => (tab = 'timing')}>{t('req.tab.timing')}</button>
        </div>
      </div>
      <div class="dbody">
        {#if tab === 'response'}
          <div class="lbl">{t('common.prompt')}</div>
          <pre class="box">{promptOf(sel) || t('req.none')}</pre>
          {#if sel.thinkingText}
            <div class="lbl">{t('common.thinking')}</div>
            <pre class="box think">{sel.thinkingText}</pre>
          {/if}
          <div class="lbl">{t('common.reply')}</div>
          <pre class="box">{sel.responseText || t('req.empty')}</pre>
        {:else if tab === 'request'}
          <div class="row"><div class="lbl">{t('req.body')}</div><span class="grow"></span>
            <button class="btn sm ghost" title={t('req.copyBody')} aria-label={t('req.copyBody')} onclick={() => store.copy(JSON.stringify(sel.requestBody, null, 2), t('req.bodyCopied'))}><Icon name="copy" size={12} /></button>
          </div>
          <pre class="box">{JSON.stringify(sel.requestBody, null, 2)}</pre>
        {:else}
          <table class="timing">
            <tbody>
              <tr><td>{t('req.received')}</td><td class="mono">{fmtClock(sel.t.received)}</td></tr>
              {#each ph.p as p (p.k)}
                <tr><td><i class="sw {p.cls}"></i>{p.k}</td><td class="mono">{fmtMs(p.ms)}</td></tr>
              {/each}
              <tr><td><b>{t('common.total')}</b></td><td class="mono"><b>{fmtMs(ph.total)}</b></td></tr>
            </tbody>
          </table>
          {#if sel.reported}
            {@const rep = sel.reported}
            <div class="lbl rep">{t('req.reported')}</div>
            <table class="timing">
              <tbody>
                <tr><td><i class="sw l"></i>{t('req.rep.load')}</td><td class="mono">{fmtMs(rep.loadMs)}</td><td></td></tr>
                <tr>
                  <td><i class="sw w"></i>{t('req.rep.prompt')}</td><td class="mono">{fmtMs(rep.promptMs)}</td>
                  <td class="mono muted">{t('req.rep.tokens', { n: rep.promptTokens })}</td>
                </tr>
                <tr>
                  <td><i class="sw s"></i>{t('req.rep.eval')}</td><td class="mono">{fmtMs(rep.evalMs)}</td>
                  <td class="mono muted"
                    >{t('req.rep.rate', { n: rep.evalTokens, rate: rep.evalMs ? ((rep.evalTokens * 1000) / rep.evalMs).toFixed(1) : '–' })}</td
                  >
                </tr>
                <tr><td><b>{t('req.rep.total')}</b></td><td class="mono"><b>{fmtMs(rep.totalMs)}</b></td><td></td></tr>
              </tbody>
            </table>
          {/if}
        {/if}
      </div>
    {:else}
      <div class="empty full">
        <Icon name="list" size={28} />
        <p>{t('req.select')}</p>
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(360px, 1fr);
    gap: 12px;
    height: 100%;
    padding: 16px 18px;
  }
  .left,
  .right {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .export {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 6px;
    color: var(--muted);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-bottom: 1px solid var(--line);
  }
  .toolbar > .input {
    /* A narrow window puts the filter on a line of its own rather than squash it. */
    flex: 1 1 180px;
    min-width: 180px;
  }
  .table {
    flex: 1;
    overflow: auto;
  }
  .r {
    text-align: right;
  }
  .table :global(td),
  .table :global(th) {
    padding-left: 8px;
    padding-right: 8px;
    font-size: 12px;
  }
  .table :global(th) {
    white-space: nowrap;
  }
  .ell {
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .f {
    margin-left: 4px;
    padding: 0 5px;
  }
  .dhead {
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font-size: 12px;
  }
  .facts em {
    font-style: normal;
    color: var(--muted);
    margin-right: 5px;
  }
  .facts .bad {
    color: var(--red);
  }
  .phasebar {
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--line);
    gap: 1px;
  }
  .phasebar i,
  .sw {
    display: block;
    flex-basis: 0;
  }
  .q {
    background: color-mix(in srgb, var(--muted) 45%, transparent);
  }
  .l {
    background: var(--violet);
  }
  .w {
    background: var(--amber);
  }
  .s {
    background: var(--accent);
  }
  .sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    margin-right: 8px;
    vertical-align: -1px;
  }
  .err {
    color: var(--red);
    background: var(--red-soft);
    padding: 6px 10px;
    border-radius: 6px;
  }
  .tabs {
    align-self: flex-start;
  }
  .dbody {
    flex: 1;
    overflow: auto;
    padding: 12px 16px 16px;
  }
  .lbl {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 10px 0 5px;
  }
  .lbl:first-child {
    margin-top: 0;
  }
  .box {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    line-height: 1.6;
  }
  .box.think {
    color: var(--blue);
  }
  .timing td {
    padding: 6px 16px 6px 0;
  }
  .lbl.rep {
    margin-top: 18px;
  }
  .full {
    height: 100%;
    gap: 10px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
</style>
