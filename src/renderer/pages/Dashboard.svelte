<script lang="ts">
import AreaChart from '../components/AreaChart.svelte'
import Icon from '../components/Icon.svelte'
import Slots from '../components/Slots.svelte'
import Waterfall from '../components/Waterfall.svelte'
import {
  API_LABEL,
  duration,
  fmtClock,
  fmtMs,
  fmtNum,
  matchLabel,
  percentile,
  statusChip,
  ttft,
} from '../lib/format.ts'
import { t } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

const snap = $derived(store.snapshot)
const cfg = $derived(store.config)
const recent = $derived(store.history.slice(-100))
const gen = $derived(
  recent.filter((r) => r.api !== 'pull' && r.api !== 'embed' && r.api !== 'openai-embed'),
)
const ttftP50 = $derived(percentile(gen.filter((r) => r.state === 'done').map(ttft), 50))
const latP95 = $derived(
  percentile(
    gen.filter((r) => r.state === 'done').map((r) => duration(r)),
    95,
  ),
)
const tpsNow = $derived(snap?.tpsSeries.at(-1) ?? 0)
const tpsAvg = $derived.by(() => {
  const s = (snap?.tpsSeries ?? []).slice(-10)
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0
})
const totals = $derived(snap?.totals)
const errRate = $derived(
  totals && totals.requests ? ((totals.errors + totals.rejected) / totals.requests) * 100 : 0,
)
const busy = $derived(snap?.slots.filter((s) => s.requestId !== null).length ?? 0)

/** The request to show in the live stream panel: the newest streaming one, else the last finished. */
const live = $derived.by(() => {
  const act = (snap?.active ?? []).filter((r) => r.responseText || r.thinkingText)
  return act.at(-1) ?? store.history.findLast((r) => r.responseText && r.api !== 'pull') ?? null
})

function setParallel(delta: number) {
  const next = (c: { numParallel: number }) => Math.max(1, Math.min(64, c.numParallel + delta))
  void store.updateConfig((c) => ({ numParallel: next(c) }), '')
}
</script>

<div class="page">
  <div class="kpis">
    <div class="kpi card">
      <span class="k">{t('dash.tps')}</span>
      <b class="v accent">{tpsNow}</b>
      <span class="s">{t('dash.avg10', { n: tpsAvg.toFixed(1) })}</span>
    </div>
    <div class="kpi card">
      <span class="k">{t('dash.inFlight')}</span>
      <b class="v">{busy}<small>/{cfg?.numParallel ?? '–'}</small></b>
      <span class="s">{t('dash.queued', { n: snap?.queue.length ?? 0 })}</span>
    </div>
    <div class="kpi card">
      <span class="k">{t('dash.requests')}</span>
      <b class="v">{fmtNum(totals?.requests ?? 0)}</b>
      <span class="s">{t('dash.tokensOut', { n: fmtNum(totals?.tokens ?? 0) })}</span>
    </div>
    <div class="kpi card">
      <span class="k">{t('dash.ttftP50')}</span>
      <b class="v amber">{Number.isFinite(ttftP50) ? fmtMs(ttftP50) : '–'}</b>
      <span class="s"
        >{cfg?.mode === 'proxy'
          ? t('dash.viaOllama')
          : t('dash.ttftSet', { ms: cfg?.ttftMs ?? '–', pct: Math.round((cfg?.jitter ?? 0) * 100) })}</span
      >
    </div>
    <div class="kpi card">
      <span class="k">{t('dash.latP95')}</span>
      <b class="v">{Number.isFinite(latP95) ? fmtMs(latP95) : '–'}</b>
      <span class="s">{t('dash.lastN', { n: gen.length })}</span>
    </div>
    <div class="kpi card" class:bad={errRate > 0}>
      <span class="k">{t('dash.errors')}</span>
      <b class="v" class:red={errRate > 0}>{errRate.toFixed(errRate && errRate < 10 ? 1 : 0)}<small>%</small></b>
      <span class="s">{t('dash.errBreakdown', { err: totals?.errors ?? 0, rej: totals?.rejected ?? 0, ab: totals?.aborted ?? 0 })}</span>
    </div>
  </div>

  <div class="two">
    <section class="card">
      <div class="card-head"><h3>{t('dash.throughput')}</h3><span class="grow"></span><span class="chip accent">tok/s</span></div>
      <div class="card-body"><AreaChart series={snap?.tpsSeries.slice(-90) ?? []} unit="" minMax={10} label={t('dash.tpsLabel')} /></div>
    </section>
    <section class="card">
      <div class="card-head">
        <h3>{t('dash.load')}</h3><span class="grow"></span><span class="chip blue">{t('dash.busySlots')}</span><span class="chip amber">{t('dash.queue')}</span>
      </div>
      <div class="card-body stack">
        <AreaChart series={snap?.busySeries.slice(-90) ?? []} color="var(--blue)" height={70} minMax={cfg?.numParallel ?? 1} step />
        <AreaChart series={snap?.queueSeries.slice(-90) ?? []} color="var(--amber)" height={50} minMax={2} step />
      </div>
    </section>
  </div>

  <section class="card">
    <div class="card-head">
      <h3>{t('dash.slots')}</h3>
      <span class="muted small">OLLAMA_NUM_PARALLEL</span>
      <span class="grow"></span>
      <div class="stepper">
        <button class="btn sm icon" onclick={() => setParallel(-1)} title={t('dash.fewer')}>−</button>
        <span class="mono">{cfg?.numParallel}</span>
        <button class="btn sm icon" onclick={() => setParallel(1)} title={t('dash.more')}>+</button>
      </div>
    </div>
    <div class="card-body"><Slots /></div>
  </section>

  <section class="card">
    <div class="card-head">
      <h3>{t('dash.timeline')}</h3>
      <span class="grow"></span>
      <span class="legend"
        ><i class="q"></i>{t('phase.queue')} <i class="l"></i>{t('phase.load')} <i class="w"></i>{t('phase.firstToken')}
        <i class="t"></i>{t('phase.thinking')} <i class="s"></i>{t('phase.stream')} <i class="e"></i>{t('phase.error')}</span
      >
    </div>
    <div class="card-body"><Waterfall /></div>
  </section>

  <div class="two">
    <section class="card live">
      <div class="card-head">
        <h3>{t('dash.live')}</h3>
        {#if live}
          <span class="chip">#{live.id}</span><span class="mono small muted">{live.model}</span>
          {#if live.match}<span class="chip violet">{matchLabel(live.match)}</span>{/if}
        {/if}
      </div>
      <div class="card-body">
        {#if live}
          {#if live.thinkingText}
            <pre class="think">{live.thinkingText}</pre>
          {/if}
          <pre class="out">{live.responseText}{#if !live.t.ended}<span class="caret"></span>{/if}</pre>
        {:else}
          <div class="empty">
            {t('dash.emptyBefore')}
            <button class="btn sm" onclick={() => (store.page = 'playground')}>{t('nav.playground')}</button>
            {t('dash.emptyAfter')}
          </div>
        {/if}
      </div>
    </section>
    <section class="card recent">
      <div class="card-head">
        <h3>{t('dash.recent')}</h3><span class="grow"></span>
        <button class="btn sm ghost" onclick={() => (store.page = 'requests')}>{t('dash.allRequests')} <Icon name="list" size={12} /></button>
      </div>
      <div class="card-body list">
        {#each store.history.slice(-9).reverse() as r (r.id)}
          {@const c = statusChip(r)}
          <button class="rrow" onclick={() => store.open('requests', r.id)}>
            <span class="mono muted">{fmtClock(r.t.received)}</span>
            <span class="chip {c.cls}">{c.label}</span>
            <span class="mono">{API_LABEL[r.api]}</span>
            <span class="mono muted grow ell">{r.model}</span>
            <span class="mono num">{fmtMs(duration(r))}</span>
          </button>
        {:else}
          <div class="empty">{t('common.noRequests')}</div>
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
  }
  .kpi {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .kpi .k {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--muted);
  }
  .kpi .v {
    font: 600 26px/1.15 var(--mono);
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .kpi .v small {
    font-size: 14px;
    color: var(--muted);
    margin-left: 2px;
  }
  .kpi .s {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .accent {
    color: var(--accent);
  }
  .amber {
    color: var(--amber);
  }
  .red {
    color: var(--red);
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .small {
    font-size: 11px;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
    margin-left: 6px;
  }
  .legend .q {
    background: color-mix(in srgb, var(--muted) 30%, transparent);
  }
  .legend .l {
    background: var(--violet);
  }
  .legend .w {
    background: var(--amber);
  }
  .legend .t {
    background: var(--blue);
  }
  .legend .s {
    background: var(--accent);
  }
  .legend .e {
    background: var(--red);
  }
  .live pre {
    max-height: 190px;
    overflow: auto;
    font-size: 12.5px;
    line-height: 1.6;
  }
  .live .think {
    color: var(--blue);
    opacity: 0.8;
    border-left: 2px solid var(--blue);
    padding-left: 10px;
    margin-bottom: 8px;
    max-height: 70px;
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 14px;
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
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 8px;
  }
  .rrow {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 26px;
    padding: 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .rrow:hover {
    background: var(--panel-2);
  }
  .ell {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 1180px) {
    .kpis {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
