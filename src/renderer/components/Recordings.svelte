<script lang="ts">
import type { Recording, RecordingSummary } from '../../shared/types.ts'
import { fmtMs } from '../lib/format.ts'
import { i18n, t } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'
import Hint from './Hint.svelte'
import Icon from './Icon.svelte'

const api = window.mockolla
/** Rows drawn at once; the filter finds the rest. Thousands of rows would slow the page. */
const SHOWN = 300

/** The recordings tab of the Rules page: what was recorded, and deleting it. */
let filter = $state('')
let selId = $state<string | null>(null)

const rows = $derived.by(() => {
  const f = filter.trim().toLowerCase()
  const list = [...store.recordings].reverse()
  if (!f) return list
  return list.filter((r) => `${r.prompt} ${r.model} ${r.preview}`.toLowerCase().includes(f))
})
const shown = $derived(rows.length > SHOWN ? rows.slice(0, SHOWN) : rows)
const sel = $derived<RecordingSummary | undefined>(
  store.recordings.find((r) => r.id === selId) ?? rows[0],
)

/** The whole recording (conversation and reply) is fetched from main for the one shown. */
let detail = $state.raw<Recording | null>(null)
let detailSeq = 0
$effect(() => {
  const id = sel?.id
  const seq = ++detailSeq
  if (!id) {
    detail = null
    return
  }
  void api.getRecording(id).then((r) => {
    if (seq === detailSeq) detail = r
  })
})
const playback = $derived(!!store.config?.replay && store.config.mode !== 'proxy')

/** Settings › Recordings, where recording and playback are turned on. */
const toRecSettings = () => ({
  page: 'settings' as const,
  section: 'sec-recordings',
  path: [t('nav.settings'), t('set.sec.recordings')],
})

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(i18n.locale === 'ja' ? 'ja-JP' : 'en-US')
}

async function removeAll() {
  const n = store.recordings.length
  if (n && confirm(t('rec.confirmAll', { n, path: store.recordingsPath })))
    await store.deleteRecordings('all')
}
</script>

<div class="rec">
  <div class="bar">
    <input class="input" bind:value={filter} placeholder={t('rec.filter')} />
    <button class="btn sm danger" onclick={removeAll} disabled={!store.recordings.length}>
      <Icon name="trash" size={13} />{t('rec.deleteAll')}
    </button>
  </div>
  <p class="muted intro">{t('rec.intro')}</p>
  {#if store.recordings.length && !playback}
    <div class="off"><Hint text={t('rec.playbackOff')} links={{ a: toRecSettings() }} /></div>
  {/if}

  {#if !store.recordings.length}
    <div class="card empty"><Hint text={t('rec.empty')} links={{ a: toRecSettings() }} /></div>
  {:else}
    <div class="split">
      <section class="card list">
        {#each shown as r (r.id)}
          <button class="item" class:on={r.id === sel?.id} onclick={() => (selId = r.id)}>
            <span class="p">{r.prompt || '…'}</span>
            <span class="m mono">{r.model} · {r.chunks} · {r.tps || '–'} tok/s</span>
          </button>
        {/each}
        {#if rows.length > shown.length}
          <p class="muted small more">{t('rec.more', { shown: shown.length, n: rows.length })}</p>
        {/if}
      </section>

      <section class="card detail">
        {#if sel}
          <div class="card-body col">
            <div class="row">
              <span class="chip violet mono">{sel.model}</span>
              <span class="chip mono">{sel.api}</span>
              <span class="grow"></span>
              <button class="btn sm icon danger" title={t('common.delete')} onclick={() => store.deleteRecordings([sel.id])}>
                <Icon name="trash" size={13} />
              </button>
            </div>
            <div class="muted small">
              {t('rec.meta', { chunks: sel.chunks, ttft: fmtMs(sel.ttftMs), tps: sel.tps || '–' })}
              · {t('rec.recordedAt', { at: when(sel.recordedAt), source: sel.source || '?' })}
            </div>
            {#if detail && detail.id === sel.id}
              <div class="lbl">{t('rec.conversation')}</div>
              <pre class="box">{detail.conversation}</pre>
              {#if detail.thinking.length}
                <div class="lbl">{t('common.thinking')}</div>
                <pre class="box think">{detail.thinking.join('')}</pre>
              {/if}
              <div class="lbl">{t('common.reply')}</div>
              <pre class="box chunks">{#each detail.chunks as c, i (i)}<span class:alt={i % 2 === 1}>{c}</span>{/each}</pre>
              {#if detail.toolCalls.length}
                <div class="lbl">{t('rec.toolCalls')}</div>
                <pre class="box">{detail.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.arguments)})`).join('\n')}</pre>
              {/if}
            {/if}
          </div>
        {:else}
          <div class="empty">{t('rec.select')}</div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .more {
    padding: 8px 12px;
  }
  .rec {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar {
    display: flex;
    gap: 8px;
  }
  .bar .input {
    flex: 1;
  }
  .intro {
    margin: 0;
    font-size: 12px;
  }
  .off {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    background: var(--amber-soft);
    color: var(--amber);
  }
  .empty {
    padding: 24px;
  }
  .split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.6fr);
    gap: 12px;
  }
  .list,
  .detail {
    min-height: 0;
    overflow: auto;
  }
  .list {
    padding: 6px;
  }
  .item {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: 2px;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 7px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .item:hover {
    background: var(--panel-2);
  }
  .item.on {
    background: var(--panel-2);
    border-color: var(--line-2);
  }
  .p {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m {
    font-size: 11px;
    color: var(--muted);
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .small {
    font-size: 11.5px;
  }
  .lbl {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 6px;
  }
  .box {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    line-height: 1.6;
    max-height: 260px;
    overflow: auto;
  }
  .think {
    color: var(--blue);
  }
  /* Alternate shading shows where each streamed chunk begins and ends. */
  .chunks .alt {
    background: var(--accent-soft);
    border-radius: 2px;
  }
</style>
