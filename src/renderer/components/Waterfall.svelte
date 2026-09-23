<script lang="ts">
import type { RequestRecord } from '../../shared/types.ts'
import { t as tr } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

/**
 * The last `windowSec` seconds of traffic as a live waterfall: one bar per
 * request, split into queue, model load, time to first token and streaming.
 * Bars keep their lane while visible, so nothing jumps between frames.
 */
let { windowSec = 30, lanes = 12 }: { windowSec?: number; lanes?: number } = $props()

const LANE_H = 18
const GAP = 5
const AXIS = 18

let width = $state(600)
let now = $state(Date.now())

$effect(() => {
  let raf = 0
  const tick = () => {
    const s = store.snapshot
    // Interpolate between snapshots (5/s) so bars grow smoothly at 60 fps.
    now =
      s && store.status.status === 'running'
        ? s.now + (performance.now() - store.snapshotAt)
        : (s?.now ?? Date.now())
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
})

const laneOf = new Map<number, number>()

const visible = $derived.by(() => {
  const from = now - windowSec * 1000
  const active = store.snapshot?.active ?? []
  const done = store.history.filter((r) => r.t.ended >= from)
  const recs = [...done, ...active].sort((a, b) => a.t.received - b.t.received)
  const ids = new Set(recs.map((r) => r.id))
  for (const id of laneOf.keys()) if (!ids.has(id)) laneOf.delete(id)
  const busyUntil: number[] = new Array(lanes).fill(-Infinity)
  for (const r of recs) {
    const l = laneOf.get(r.id)
    if (l !== undefined)
      busyUntil[l] = Math.max(busyUntil[l] ?? 0, r.t.ended || Number.POSITIVE_INFINITY)
  }
  const out: { r: RequestRecord; lane: number }[] = []
  let hidden = 0
  for (const r of recs) {
    let l = laneOf.get(r.id)
    if (l === undefined) {
      l = busyUntil.findIndex((end) => end < r.t.received - 150)
      if (l < 0) {
        hidden++
        continue
      }
      laneOf.set(r.id, l)
      busyUntil[l] = r.t.ended || Number.POSITIVE_INFINITY
    }
    out.push({ r, lane: l })
  }
  return { items: out, hidden, from }
})

const x = (t: number) => ((t - visible.from) / (windowSec * 1000)) * width
const height = $derived(lanes * (LANE_H + GAP) + AXIS)

function segments(r: RequestRecord) {
  const end = r.t.ended || now
  const started = r.t.started || end
  const loadEnd = r.t.started ? Math.min(end, r.t.started + r.loadMs) : started
  const segs: { a: number; b: number; cls: string }[] = []
  segs.push({ a: r.t.received, b: started, cls: 'queue' })
  if (r.loadMs > 0) segs.push({ a: started, b: loadEnd, cls: 'load' })
  segs.push({ a: loadEnd, b: r.t.firstToken ? r.t.firstToken : end, cls: 'wait' })
  if (r.t.firstToken)
    segs.push({
      a: r.t.firstToken,
      b: end,
      cls: r.thinkingText && !r.responseText ? 'think' : 'stream',
    })
  return segs.filter((s) => s.b > s.a)
}

const ticks = $derived(Array.from({ length: Math.floor(windowSec / 5) + 1 }, (_, i) => i * 5))
</script>

<div class="wf" bind:clientWidth={width}>
  <svg {width} {height}>
    {#each ticks as t (t)}
      {@const tx = width - (t / windowSec) * width}
      <line x1={tx} x2={tx} y1="0" y2={height - AXIS} class="grid" />
      <text x={tx} y={height - 5} class="tick" text-anchor={t === 0 ? 'end' : t === windowSec ? 'start' : 'middle'}
        >{t === 0 ? tr('common.now') : `-${t}s`}</text
      >
    {/each}
    {#each visible.items as { r, lane } (r.id)}
      {@const y = lane * (LANE_H + GAP)}
      {@const x0 = Math.max(0, x(r.t.received))}
      {@const x1 = x(r.t.ended || now)}
      <g
        class="bar"
        class:live={!r.t.ended}
        role="button"
        tabindex="-1"
        onclick={() => store.open('requests', r.id)}
        onkeydown={() => {}}
      >
        <title>#{r.id} {r.model} · {tr(`state.${r.state}`)}</title>
        {#each segments(r) as s, i (i)}
          {@const a = Math.max(0, x(s.a))}
          {@const b = Math.max(a + 1, x(s.b))}
          <rect x={a} {y} width={b - a} height={LANE_H} class="seg {s.cls}" rx="3" />
        {/each}
        {#if r.state === 'error'}
          <rect x={x1 - 3} {y} width="3" height={LANE_H} class="cap err" />
        {:else if r.state === 'aborted'}
          <rect x={x1 - 3} {y} width="3" height={LANE_H} class="cap abort" />
        {/if}
        {#if x1 - x0 > 70}
          <text x={x0 + 6} y={y + 13} class="label">#{r.id} {r.model}</text>
        {/if}
      </g>
    {/each}
  </svg>
  {#if visible.hidden}
    <div class="more">{tr('wf.more', { n: visible.hidden })}</div>
  {/if}
  {#if !visible.items.length}
    <div class="idle">{tr('wf.idle', { n: windowSec })}</div>
  {/if}
</div>

<style>
  .wf {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
  }
  .grid {
    stroke: var(--line);
    stroke-dasharray: 2 4;
  }
  .tick {
    fill: var(--muted);
    font: 10px var(--mono);
  }
  .bar {
    cursor: pointer;
    outline: none;
  }
  .bar:hover .seg {
    filter: brightness(1.25);
  }
  .seg.queue {
    fill: color-mix(in srgb, var(--muted) 30%, transparent);
  }
  .seg.load {
    fill: var(--violet);
    opacity: 0.85;
  }
  .seg.wait {
    fill: var(--amber);
    opacity: 0.85;
  }
  .seg.think {
    fill: var(--blue);
  }
  .seg.stream {
    fill: var(--accent);
  }
  .live .seg.stream {
    fill: var(--accent);
    animation: glow 1.2s ease-in-out infinite;
  }
  @keyframes glow {
    50% {
      opacity: 0.7;
    }
  }
  .cap.err {
    fill: var(--red);
  }
  .cap.abort {
    fill: var(--muted);
  }
  .label {
    fill: var(--text);
    stroke: var(--panel);
    stroke-width: 3px;
    stroke-linejoin: round;
    paint-order: stroke;
    font: 600 10px var(--mono);
    pointer-events: none;
  }
  .more {
    position: absolute;
    right: 0;
    top: -22px;
    font-size: 11px;
    color: var(--muted);
  }
  .idle {
    position: absolute;
    inset: 0 0 18px;
    display: grid;
    place-items: center;
    color: var(--muted);
    pointer-events: none;
  }
</style>
