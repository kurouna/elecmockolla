<script lang="ts">
import type { PlaygroundApi } from '../../shared/api.ts'
import type { FaultMode, FaultSetting } from '../../shared/types.ts'
import Icon from '../components/Icon.svelte'
import Rich from '../components/Rich.svelte'
import { t } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

const api = window.mockolla

const FAULTS: FaultMode[] = ['error500', 'disconnect', 'hang', 'malformed']

let rate = $state(Math.round((store.config?.faultRate ?? 0) * 100))
let mode = $state<FaultSetting>(store.config?.faultMode ?? 'random')

let concurrency = $state(8)
let total = $state(60)
let lgApi = $state<PlaygroundApi>('chat')
let randomModels = $state(true)

const pending = $derived(store.snapshot?.pendingFaults ?? [])
const lg = $derived(store.loadGen)
const running = $derived(store.status.status === 'running')

async function saveRate() {
  await store.saveConfig(
    { faultRate: rate / 100, faultMode: mode },
    rate
      ? t('chaos.rateSaved', {
          rate,
          mode: mode === 'random' ? t('chaos.randomMix') : t(`fault.${mode}`),
        })
      : t('chaos.rateOff'),
  )
}
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h2>{t('nav.chaos')}</h2>
      <p>{t('chaos.intro')}</p>
    </div>
  </div>

  <div class="grid2">
    <section class="card">
      <div class="card-head"><h3>{t('chaos.inject')}</h3></div>
      <div class="card-body">
        <div class="faults">
          {#each FAULTS as f (f)}
            <div class="fault">
              <div class="grow">
                <b>{t(`fault.${f}`)}</b>
                <div class="muted small">{t(`fault.${f}.desc`)}</div>
              </div>
              <button class="btn sm" disabled={!running} onclick={() => api.injectFault(f, 1)}>×1</button>
              <button class="btn sm" disabled={!running} onclick={() => api.injectFault(f, 5)}>×5</button>
            </div>
          {/each}
        </div>
        <div class="pending">
          <span class="muted">{t('chaos.pending')}</span>
          {#each pending.slice(0, 20) as p, i (i)}<span class="chip red">{t(`fault.${p}`)}</span>{:else}<span class="muted">{t('common.none')}</span>{/each}
          {#if pending.length > 20}<span class="muted">+{pending.length - 20}</span>{/if}
          <span class="grow"></span>
          {#if pending.length}<button class="btn sm ghost" onclick={() => api.clearFaults()}>{t('chaos.clear')}</button>{/if}
        </div>
        <p class="muted small tip"><Rich text={t('chaos.rulesTip')} /></p>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>{t('chaos.random')}</h3>{#if (store.config?.faultRate ?? 0) > 0}<span class="chip amber">{t('chaos.active')}</span>{/if}</div>
      <div class="card-body col">
        <label class="field">
          <span>{t('chaos.probability')} <b class="mono">{rate}%</b></span>
          <input type="range" min="0" max="100" bind:value={rate} class="range" />
        </label>
        <label class="field">
          <span>{t('chaos.kind')}</span>
          <select class="select" bind:value={mode}>
            <option value="random">{t('chaos.randomMix')}</option>
            {#each FAULTS as f (f)}<option value={f}>{t(`fault.${f}`)}</option>{/each}
          </select>
        </label>
        <div class="row">
          <button class="btn primary" onclick={saveRate}><Icon name="save" size={13} />{t('chaos.apply')}</button>
          {#if (store.config?.faultRate ?? 0) > 0}
            <button class="btn" onclick={() => { rate = 0; void saveRate() }}>{t('chaos.turnOff')}</button>
          {/if}
        </div>
        <p class="muted small">{t('chaos.savedAs')}</p>
      </div>
    </section>
  </div>

  <section class="card" id="loadgen">
    <div class="card-head"><h3>{t('chaos.loadGen')}</h3><span class="muted small">{t('chaos.loadGenIntro')}</span></div>
    <div class="card-body">
      <div class="lg">
        <label class="field"><span>{t('chaos.concurrency')}</span><input class="input" type="number" min="1" max="256" bind:value={concurrency} /></label>
        <label class="field"><span>{t('chaos.total')}</span><input class="input" type="number" min="1" max="10000" bind:value={total} /></label>
        <label class="field">
          <span>API</span>
          <select class="select" bind:value={lgApi}>
            <option value="chat">/api/chat</option>
            <option value="generate">/api/generate</option>
            <option value="openai">/v1/chat/completions</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={randomModels} />{t('chaos.randomModels')}</label>
        {#if lg.running}
          <button class="btn danger" onclick={() => api.stopLoadGen()}><Icon name="stop" size={13} />{t('common.stop')}</button>
        {:else}
          <button class="btn primary" disabled={!running} onclick={() => api.loadGen({ concurrency, total, api: lgApi, randomModels })}>
            <Icon name="zap" size={13} />{t('chaos.run')}
          </button>
        {/if}
        <button class="btn ghost" onclick={() => (store.page = 'dashboard')}>{t('chaos.watch')}</button>
      </div>
      {#if lg.total}
        <div class="progress">
          <div class="pbar">
            <i class="ok" style:width="{(lg.ok / lg.total) * 100}%"></i>
            <i class="bad" style:width="{(lg.failed / lg.total) * 100}%"></i>
          </div>
          <span class="mono">{lg.ok + lg.failed}/{lg.total}</span>
          <span class="chip green">{t('chaos.ok', { n: lg.ok })}</span>
          {#if lg.failed}<span class="chip red">{t('chaos.failed', { n: lg.failed })}</span>{/if}
          {#if lg.running}<span class="chip accent">{t('chaos.running')}</span>{/if}
        </div>
      {/if}
      <p class="muted small tip">
        <Rich text={t('chaos.tip', { slots: store.config?.numParallel ?? '?', queue: store.config?.maxQueue ?? '?' })} />
      </p>
    </div>
  </section>
</div>

<style>
  .grid2 {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .faults {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .fault {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg-2);
    border: 1px solid var(--line);
  }
  .small {
    font-size: 11.5px;
  }
  .pending {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 12px;
    min-height: 26px;
  }
  .tip {
    margin: 12px 0 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .range {
    width: 100%;
    accent-color: var(--red);
  }
  .lg {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }
  .lg .field {
    width: 150px;
  }
  .lg .check {
    height: 30px;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
  }
  .pbar {
    flex: 1;
    display: flex;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--line);
  }
  .pbar i {
    display: block;
    transition: width 0.2s;
  }
  .pbar .ok {
    background: var(--accent);
  }
  .pbar .bad {
    background: var(--red);
  }
</style>
