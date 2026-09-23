<script lang="ts">
import { t } from '../lib/i18n.svelte.ts'

/**
 * A small live area chart: one value per second, newest on the right.
 * Scales to its container; the y axis grows with the data and never jumps down abruptly.
 */
let {
  series,
  color = 'var(--accent)',
  height = 120,
  unit = '',
  minMax = 1,
  step = false,
  label = '',
}: {
  series: number[]
  color?: string
  height?: number
  unit?: string
  minMax?: number
  step?: boolean
  label?: string
} = $props()

let width = $state(400)
const id = `g${Math.random().toString(36).slice(2, 8)}`
const PAD_T = 8
const PAD_B = 18

const max = $derived(Math.max(minMax, ...series) * 1.15)
const h = $derived(height - PAD_T - PAD_B)
const pts = $derived(
  series.map((v, i) => {
    const x = series.length > 1 ? (i / (series.length - 1)) * width : 0
    return [x, PAD_T + h - (v / max) * h] as const
  }),
)
const line = $derived.by(() => {
  if (!pts.length) return ''
  if (!step)
    return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  return pts
    .map(([x, y], i) =>
      i ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`,
    )
    .join('')
})
const area = $derived(line ? `${line}L${width},${PAD_T + h}L0,${PAD_T + h}Z` : '')
const last = $derived(series.at(-1) ?? 0)
const ticks = $derived([0, 0.5, 1].map((f) => ({ y: PAD_T + h - f * h, v: (max / 1.15) * f })))
const fmt = (v: number) =>
  v >= 100 ? Math.round(v).toString() : v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, '')
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
  <svg {width} {height} role="img" aria-label={label}>
    <defs>
      <linearGradient {id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity="0.35" />
        <stop offset="100%" stop-color={color} stop-opacity="0" />
      </linearGradient>
    </defs>
    {#each ticks as t (t.y)}
      <line x1="0" x2={width} y1={t.y} y2={t.y} class="grid" />
      <text x="4" y={t.y - 3} class="tick">{fmt(t.v)}{unit}</text>
    {/each}
    {#if area}
      <path d={area} fill="url(#{id})" />
      <path d={line} fill="none" stroke={color} stroke-width="1.8" stroke-linejoin="round" />
      {#if pts.length}
        {@const p = pts[pts.length - 1]}
        {#if p}
          <circle cx={p[0] - 1} cy={p[1]} r="3" fill={color} />
        {/if}
      {/if}
    {/if}
    <text x={width - 4} y={height - 4} class="tick end">{t('common.now')}</text>
    <text x="4" y={height - 4} class="tick">-{series.length}s</text>
  </svg>
  <div class="last" style:color>{fmt(last)}<small>{unit}</small></div>
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .grid {
    stroke: var(--line);
    stroke-dasharray: 2 4;
  }
  .tick {
    fill: var(--muted);
    font-size: 10px;
    font-family: var(--mono);
  }
  .tick.end {
    text-anchor: end;
  }
  .last {
    position: absolute;
    top: 0;
    right: 4px;
    font: 600 20px/1 var(--mono);
    letter-spacing: -0.02em;
  }
  .last small {
    font-size: 11px;
    margin-left: 2px;
    color: var(--muted);
  }
</style>
