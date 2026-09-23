<script lang="ts">
import type { RequestRecord } from '../../shared/types.ts'
import { fmtMs, rate } from '../lib/format.ts'
import { t, tOr } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

/** One card per parallel slot, like OLLAMA_NUM_PARALLEL, plus the wait queue. */
const snap = $derived(store.snapshot)
const byId = $derived(new Map((snap?.active ?? []).map((r) => [r.id, r])))
const slots = $derived(
  (snap?.slots ?? []).map((s) => ({
    ...s,
    r: s.requestId !== null ? byId.get(s.requestId) : undefined,
  })),
)
const queue = $derived(
  (snap?.queue ?? []).map((id) => byId.get(id)).filter((r): r is RequestRecord => !!r),
)

function progress(r: RequestRecord): number {
  if (!r.plannedTokens) return 0
  return Math.min(1, r.tokens / r.plannedTokens)
}
const tail = (s: string) => s.replace(/\s+/g, ' ').slice(-90)
</script>

<div class="slots">
  {#each slots as s (s.index)}
    <button
      class="slot {s.r?.state ?? 'idle'}"
      class:over={store.config && s.index >= store.config.numParallel}
      disabled={!s.r}
      onclick={() => s.r && store.open('requests', s.r.id)}
    >
      <div class="top">
        <span class="idx">{t('slot.title', { n: s.index + 1 })}</span>
        {#if s.r}
          <span class="state">{tOr(`slot.${s.r.state}`, s.r.state)}</span>
        {:else}
          <span class="state idle-label">{t('slot.idle')}</span>
        {/if}
      </div>
      {#if s.r}
        <div class="model mono">#{s.r.id} · {s.r.model}</div>
        <div class="bar"><i style:width="{progress(s.r) * 100}%"></i></div>
        <div class="meta mono">
          <span>{s.r.tokens}/{s.r.plannedTokens || '?'} tok</span>
          <span>{rate(s.r, snap?.now).toFixed(0)} tok/s</span>
          <span>{fmtMs((snap?.now ?? 0) - s.r.t.started)}</span>
        </div>
        <div class="tail">{tail(s.r.thinkingText && !s.r.responseText ? s.r.thinkingText : s.r.responseText) || '…'}</div>
      {:else}
        <div class="model mono muted">{t('slot.noWork')}</div>
        <div class="bar"><i style:width="0%"></i></div>
      {/if}
    </button>
  {/each}
</div>
<div class="queue">
  <span class="qlabel">{t('slot.queue')}</span>
  {#if queue.length}
    <div class="qdots">
      {#each queue.slice(0, 60) as r (r.id)}
        <span class="qd" title={t('slot.queueTitle', { id: r.id, model: r.model, t: fmtMs((snap?.now ?? 0) - r.t.received) })}></span>
      {/each}
      {#if queue.length > 60}<span class="muted">+{queue.length - 60}</span>{/if}
    </div>
    <span class="mono">{queue.length} / {store.config?.maxQueue ?? '?'}</span>
  {:else}
    <span class="muted">{t('slot.empty')}</span>
  {/if}
</div>

<style>
  .slots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
  }
  .slot {
    text-align: left;
    padding: 10px 11px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg-2);
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    cursor: pointer;
    transition:
      border-color 0.2s,
      background 0.2s;
  }
  .slot:disabled {
    cursor: default;
  }
  .slot.over {
    border-style: dashed;
  }
  .slot.streaming,
  .slot.thinking {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
    background: linear-gradient(180deg, var(--accent-soft), transparent 70%), var(--bg-2);
  }
  .slot.waiting {
    border-color: color-mix(in srgb, var(--amber) 55%, var(--line));
  }
  .slot.loading {
    border-color: color-mix(in srgb, var(--violet) 55%, var(--line));
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .idx {
    font: 600 10px var(--mono);
    letter-spacing: 0.1em;
    color: var(--muted);
  }
  .state {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
  }
  .waiting .state {
    color: var(--amber);
  }
  .loading .state {
    color: var(--violet);
  }
  .thinking .state {
    color: var(--blue);
  }
  .idle-label {
    color: var(--muted);
  }
  .model {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
  }
  .bar {
    height: 4px;
    border-radius: 4px;
    background: var(--line);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 4px;
    transition: width 0.2s linear;
  }
  .waiting .bar i,
  .loading .bar i {
    width: 30% !important;
    background: linear-gradient(90deg, transparent, var(--amber), transparent);
    animation: indeterminate 1.1s linear infinite;
  }
  .loading .bar i {
    background: linear-gradient(90deg, transparent, var(--violet), transparent);
  }
  @keyframes indeterminate {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  .meta {
    display: flex;
    justify-content: space-between;
    font-size: 10px;
    color: var(--muted);
  }
  .tail {
    font-size: 11px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    direction: rtl;
    text-align: left;
    text-overflow: clip;
  }
  .queue {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    font-size: 12px;
  }
  .qlabel {
    font: 600 10px var(--mono);
    letter-spacing: 0.1em;
    color: var(--muted);
  }
  .qdots {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    flex: 1;
  }
  .qd {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--amber) 60%, transparent);
    animation: pop 0.25s ease-out;
  }
  @keyframes pop {
    from {
      transform: scale(0);
    }
  }
</style>
