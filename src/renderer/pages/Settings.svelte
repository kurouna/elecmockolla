<script lang="ts">
import { normalizeUpstream, SERVER_MODES, serializeEnv } from '../../core/config.ts'
import type { MockConfig } from '../../shared/types.ts'
import Icon from '../components/Icon.svelte'
import Rich from '../components/Rich.svelte'
import { t, tOr } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

const api = window.mockolla

// An editable copy; nothing is applied until Save.
const initial = structuredClone($state.snapshot(store.config) as MockConfig)
let form = $state<MockConfig>(initial)
let seedText = $state(initial.seed === null ? '' : String(initial.seed))
let modelsText = $state(initial.models.join(', '))

// Follow outside changes (presets, Chaos, Models) while the form is untouched.
let base = $state(JSON.stringify(store.config))
$effect(() => {
  const next = JSON.stringify(store.config)
  if (next !== base && JSON.stringify(current()) === base && store.config) {
    form = structuredClone($state.snapshot(store.config))
    seedText = form.seed === null ? '' : String(form.seed)
    modelsText = form.models.join(', ')
  }
  base = next
})

function current(): MockConfig {
  const seed = seedText.trim() === '' ? null : Number(seedText)
  return {
    ...$state.snapshot(form),
    seed: seed !== null && Number.isFinite(seed) ? seed : null,
    models: modelsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

const dirty = $derived(JSON.stringify(current()) !== JSON.stringify(store.config))
const restartNeeded = $derived(form.host !== store.config?.host || form.port !== store.config?.port)
const preview = $derived(serializeEnv(current()))

const up = $derived(store.snapshot?.upstream ?? null)
const upstreamValid = $derived(normalizeUpstream(form.upstream) !== '')
/** This server listening on the very port the local Ollama needs. */
const portClash = $derived.by(() => {
  if (form.mode === 'mock') return false
  try {
    const u = new URL(normalizeUpstream(form.upstream))
    const local = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(u.hostname)
    return local && Number(u.port || (u.protocol === 'https:' ? 443 : 80)) === Number(form.port)
  } catch {
    return false
  }
})

async function save() {
  const c = current()
  if (await store.saveConfig(c, restartNeeded ? t('set.savedRestarted') : t('set.savedApplied'))) {
    base = JSON.stringify(store.config)
  }
}
function revert() {
  if (!store.config) return
  form = structuredClone($state.snapshot(store.config))
  seedText = form.seed === null ? '' : String(form.seed)
  modelsText = form.models.join(', ')
}
</script>

<div class="page">
  <div class="page-head">
    <div class="grow">
      <h2>{t('nav.settings')}</h2>
      <p><Rich text={t('set.intro', { path: store.envPath })} /></p>
    </div>
    <button class="btn" onclick={() => api.openFolder()}><Icon name="folder" size={14} />{t('set.openFolder')}</button>
    <button class="btn" onclick={revert} disabled={!dirty}><Icon name="undo" size={13} />{t('common.revert')}</button>
    <button class="btn primary" onclick={save} disabled={!dirty}><Icon name="save" size={13} />{restartNeeded ? t('set.saveRestart') : t('common.save')}</button>
  </div>

  <section class="card modes">
    <div class="card-head"><h3>{t('set.mode')}</h3></div>
    <div class="card-body">
      <div class="mlist">
        {#each SERVER_MODES as m (m)}
          <button class="preset" class:on={form.mode === m} onclick={() => (form.mode = m)}>
            <b>{t(`mode.${m}`)}</b>
            <small>{t(`mode.${m}.desc`)}</small>
          </button>
        {/each}
      </div>
      {#if form.mode !== 'mock'}
        <div class="upstream">
          <label class="field grow">
            <span>{t('set.upstream')}</span>
            <input class="input mono" class:invalid={!upstreamValid} bind:value={form.upstream} placeholder="http://127.0.0.1:11434/v1" />
            <small>{t('set.upstreamHelp')}</small>
          </label>
          <div class="ustatus">
            {#if store.config?.mode === 'mock' || store.config?.upstream !== normalizeUpstream(form.upstream)}
              <span class="muted">{t('set.upstreamApply')}</span>
            {:else if !up || !up.checkedAt}
              <span class="muted">{t('set.upstreamChecking')}</span>
            {:else if up.ok}
              <span class="chip green"
                ><span class="dot live"></span>{up.api === 'openai'
                  ? t('set.upstreamOkOpenai', { models: up.models.length })
                  : up.loaded === null
                    ? t('set.upstreamOkNoPs', { version: up.version, models: up.models.length })
                    : t('set.upstreamOk', { version: up.version, models: up.models.length, loaded: up.loaded.length })}</span
              >
            {:else}
              <span class="chip red">{t('set.upstreamDown', { error: up.error })}</span>
            {/if}
          </div>
        </div>
        {#if portClash}<div class="clash">{t('set.portClash', { port: form.port })}</div>{/if}
      {/if}
    </div>
  </section>

  <section class="card presets">
    <div class="card-head"><h3>{t('set.presets')}</h3><span class="muted small">{t('set.presetsNote')}</span></div>
    <div class="card-body plist">
      {#each store.presets as p (p.id)}
        {@const on = store.config && store.config.ttftMs === p.values.ttftMs && store.config.tps === p.values.tps && store.config.jitter === p.values.jitter && store.config.loadMs === p.values.loadMs}
        <button class="preset" class:on onclick={() => store.applyPreset(p.id)}>
          <b>{tOr(`preset.${p.id}.label`, p.label)}</b>
          <span class="mono">{p.values.ttftMs}ms · {p.values.tps || '∞'} tok/s</span>
          <small>{tOr(`preset.${p.id}.desc`, p.description)}</small>
        </button>
      {/each}
    </div>
  </section>

  <div class="cols">
    <div class="stack">
      <section class="card">
        <div class="card-head"><h3>{t('set.network')}</h3>{#if restartNeeded}<span class="chip amber">{t('set.restartOnSave')}</span>{/if}</div>
        <div class="card-body form">
          <label class="field"><span>{t('set.host')}</span><input class="input mono" bind:value={form.host} /><small>{t('set.hostHelp')}</small></label>
          <label class="field"><span>{t('set.port')}</span><input class="input mono" type="number" min="1" max="65535" bind:value={form.port} /><small>{t('set.portHelp')}</small></label>
          <label class="field"><span>{t('set.cors')}</span><input class="input mono" bind:value={form.cors} placeholder={t('set.corsDisabled')} /><small>{t('set.corsHelp')}</small></label>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>{t('set.capacity')}</h3></div>
        <div class="card-body form two">
          <label class="field"><span>{t('set.parallel')}</span><input class="input" type="number" min="1" max="64" bind:value={form.numParallel} /><small>OLLAMA_NUM_PARALLEL</small></label>
          <label class="field"><span>{t('set.maxQueue')}</span><input class="input" type="number" min="0" bind:value={form.maxQueue} /><small>{t('set.maxQueueHelp')}</small></label>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>{t('set.speed')}</h3></div>
        <div class="card-body form two">
          <label class="field"><span>{t('set.ttft')}</span><input class="input" type="number" min="0" bind:value={form.ttftMs} /></label>
          <label class="field"><span>{t('set.tps')}</span><input class="input" type="number" min="0" step="any" bind:value={form.tps} /><small>{t('set.tpsHelp')}</small></label>
          <label class="field"><span>{t('set.jitter', { n: Math.round(form.jitter * 100) })}</span><input type="range" min="0" max="1" step="0.05" bind:value={form.jitter} class="range" /></label>
          <label class="field"><span>{t('set.loadMs')}</span><input class="input" type="number" min="0" bind:value={form.loadMs} /><small>{t('set.loadMsHelp')}</small></label>
          <label class="field"><span>{t('set.keepAlive')}</span><input class="input" type="number" min="0" bind:value={form.keepAliveSec} /></label>
          <label class="field"><span>{t('set.pullMs')}</span><input class="input" type="number" min="0" bind:value={form.pullMs} /></label>
        </div>
      </section>
    </div>

    <div class="stack">
      <section class="card">
        <div class="card-head"><h3>{t('set.replies')}</h3></div>
        <div class="card-body form">
          <label class="field"><span>{t('set.seed')}</span><input class="input mono" bind:value={seedText} placeholder={t('set.seedRandom')} /><small>{t('set.seedHelp')}</small></label>
          <label class="field"><span>{t('set.models')}</span><textarea class="textarea mono" rows="3" bind:value={modelsText}></textarea><small>{t('set.modelsHelp')}</small></label>
          <label class="check"><input type="checkbox" bind:checked={form.strictModels} />{t('set.strict')}</label>
          <div class="two">
            <label class="field"><span>{t('set.version')}</span><input class="input mono" bind:value={form.version} /></label>
            <label class="field"><span>{t('set.embedDim')}</span><input class="input" type="number" min="1" max="8192" bind:value={form.embedDim} /></label>
          </div>
          <label class="field"><span>{t('set.rulesFile')}</span><input class="input mono" bind:value={form.rulesPath} /><small>{t('set.rulesFileHelp', { path: store.rulesPath })}</small></label>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <h3>{t('set.recordings')}</h3>
          {#if store.config?.record && store.config.mode !== 'mock'}<span class="chip red">● REC</span>{/if}
        </div>
        <div class="card-body form">
          <label class="check"><input type="checkbox" bind:checked={form.record} />{t('set.record')}</label>
          {#if form.record && form.mode === 'mock'}<small class="warnline">{t('set.recordNoProxy')}</small>{/if}
          <label class="check"><input type="checkbox" bind:checked={form.replay} />{t('set.replay')}</label>
          <small class="muted">{t('set.recordingsHelp')}</small>
          <label class="field">
            <span>{t('set.recordingsFile')}</span><input class="input mono" bind:value={form.recordingsPath} />
            <small>{t('set.recordingsFileHelp', { path: store.recordingsPath, n: store.recordings.length })}</small>
          </label>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>{t('set.envPreview')}</h3><span class="grow"></span>
          <button class="btn sm ghost" onclick={() => store.copy(preview, t('set.envCopied'))}><Icon name="copy" size={12} /></button>
        </div>
        <div class="card-body"><pre class="env">{preview}</pre></div>
      </section>
    </div>
  </div>
</div>

<style>
  .small {
    font-size: 11px;
  }
  .presets,
  .modes {
    margin-bottom: 12px;
  }
  .mlist {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .upstream {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: 12px;
  }
  .ustatus {
    padding-top: 26px;
    max-width: 50%;
  }
  .ustatus .chip {
    white-space: normal;
    height: auto;
    min-height: 22px;
  }
  .clash {
    margin-top: 10px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    background: var(--amber-soft);
    color: var(--amber);
  }
  .plist {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }
  .preset {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--line-2);
    background: var(--bg-2);
    text-align: left;
    cursor: pointer;
  }
  .preset:hover {
    border-color: var(--muted);
  }
  .preset.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .preset span {
    font-size: 11px;
    color: var(--accent);
  }
  .preset small {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.35;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .range {
    width: 100%;
    accent-color: var(--accent);
    height: 30px;
  }
  .warnline {
    color: var(--amber);
    font-size: 11.5px;
  }
  .env {
    max-height: 300px;
    overflow: auto;
    font-size: 11px;
    color: var(--text-2);
  }
</style>
