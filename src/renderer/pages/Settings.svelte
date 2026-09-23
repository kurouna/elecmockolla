<script lang="ts">
import { onMount } from 'svelte'
import { normalizeUpstream, SERVER_MODES, serializeEnv } from '../../core/config.ts'
import type { MockConfig, Preset, ServerMode } from '../../shared/types.ts'
import Icon from '../components/Icon.svelte'
import Rich from '../components/Rich.svelte'
import { type Key, t, tOr } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

const api = window.mockolla

// An editable copy; nothing is applied until Save.
const initial = structuredClone($state.snapshot(store.config) as MockConfig)
let form = $state<MockConfig>(initial)
let seedText = $state(initial.seed === null ? '' : String(initial.seed))
let modelsText = $state(initial.models.join(', '))

// Follow outside changes (Chaos, Models) while the form is untouched.
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

let saving = $state(false)
async function save() {
  if (!dirty || saving) return
  saving = true
  const sent = JSON.stringify(current())
  try {
    const ok = await store.saveConfig(
      current(),
      restartNeeded ? t('set.savedRestarted') : t('set.savedApplied'),
    )
    if (!ok) return
    base = JSON.stringify(store.config)
    // Show what was stored (main may have normalized a value), unless more was typed since.
    if (JSON.stringify(current()) === sent) revert()
  } finally {
    saving = false
  }
}

// Leaving with unsaved edits asks first.
onMount(() => {
  store.leaveGuard = () => !dirty || confirm(t('common.discard'))
  return () => {
    store.leaveGuard = null
  }
})
function revert() {
  if (!store.config) return
  form = structuredClone($state.snapshot(store.config))
  seedText = form.seed === null ? '' : String(form.seed)
  modelsText = form.models.join(', ')
}
function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void save()
  }
}

// --- which settings the chosen mode uses --------------------------------------------
// A setting the mode does not use stays visible but disabled, with the reason, so it
// can be found - and is not mistaken for one that does something now.
const usesMock = $derived(form.mode !== 'proxy')
const usesUpstream = $derived(form.mode !== 'mock')
const APPLIES: Record<'all' | 'mock' | 'upstream', Key> = {
  all: 'set.appliesAll',
  mock: 'set.appliesMock',
  upstream: 'set.appliesUpstream',
}

// --- the real Ollama (proxy and mixed modes) -----------------------------------------
const up = $derived(store.snapshot?.upstream ?? null)
const upstreamValid = $derived(normalizeUpstream(form.upstream) !== '')
/** This server listening on the very port the local Ollama needs. */
const portClash = $derived.by(() => {
  if (!usesUpstream) return false
  try {
    const u = new URL(normalizeUpstream(form.upstream))
    const local = ['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'].includes(u.hostname)
    return local && Number(u.port || (u.protocol === 'https:' ? 443 : 80)) === Number(form.port)
  } catch {
    return false
  }
})
const upstreamSaved = $derived(
  store.config?.mode !== 'mock' && store.config?.upstream === normalizeUpstream(form.upstream),
)

// --- speed presets fill the form; Save applies them like any other change -----------
function usePreset(p: Preset) {
  form.ttftMs = p.values.ttftMs
  form.tps = p.values.tps
  form.jitter = p.values.jitter
  form.loadMs = p.values.loadMs
  if (p.values.seed !== undefined) seedText = p.values.seed === null ? '' : String(p.values.seed)
}
const presetOn = (p: Preset) =>
  form.ttftMs === p.values.ttftMs &&
  form.tps === p.values.tps &&
  form.jitter === p.values.jitter &&
  form.loadMs === p.values.loadMs

// --- the table of contents follows the scroll -----------------------------------------
const SECTIONS = ['mode', 'connection', 'capacity', 'replies', 'recordings', 'file'] as const
type Section = (typeof SECTIONS)[number]
let scroller: HTMLDivElement | undefined = $state()
let active = $state<Section>('mode')
function onScroll() {
  if (!scroller) return
  const top = scroller.scrollTop + 80
  let at: Section = 'mode'
  for (const id of SECTIONS) {
    const el = scroller.querySelector<HTMLElement>(`#sec-${id}`)
    if (el && el.offsetTop <= top) at = id
  }
  // At the very bottom, the last section is the one being read.
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) at = 'file'
  active = at
}
function go(id: Section) {
  scroller?.querySelector(`#sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const modeLabel = (m: ServerMode) => t(`mode.${m}`)

/** Arrow keys move the choice within the radio group, as a native radio group does. */
function modeKey(e: KeyboardEvent) {
  const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
  const i = SERVER_MODES.indexOf(form.mode)
  const n = SERVER_MODES.length
  let next: number
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  else if (e.key in step) next = (i + (step[e.key] ?? 0) + n) % n
  else return
  e.preventDefault()
  const m = SERVER_MODES[next]
  if (!m) return
  form.mode = m
  const group = e.currentTarget as HTMLElement
  group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
}
</script>

<svelte:window onkeydown={onKey} />

<div class="settings">
  <nav class="toc" aria-label={t('nav.settings')}>
    {#each SECTIONS as id (id)}
      <button class:on={active === id} onclick={() => go(id)}>{t(`set.sec.${id}`)}</button>
    {/each}
  </nav>

  <div class="scroll" bind:this={scroller} onscroll={onScroll}>
    <div class="page-head">
      <div class="grow">
        <h2>{t('nav.settings')}</h2>
        <p><Rich text={t('set.intro', { path: store.envPath })} /></p>
      </div>
      <button class="btn" onclick={() => api.openFolder()}><Icon name="folder" size={14} />{t('set.openFolder')}</button>
    </div>

    <!-- Mode ------------------------------------------------------------------------ -->
    <section class="sec" id="sec-mode">
      <h3>{t('set.sec.mode')}</h3>
      <p class="desc">{t('set.sec.mode.desc')}</p>
      <div class="card body">
        <div class="modes" role="radiogroup" aria-label={t('set.sec.mode')} tabindex="-1" onkeydown={modeKey}>
          {#each SERVER_MODES as m (m)}
            <button class="choice" class:on={form.mode === m} role="radio" aria-checked={form.mode === m} tabindex={form.mode === m ? 0 : -1} onclick={() => (form.mode = m)}>
              <span class="radio"></span>
              <span class="grow">
                <b>{modeLabel(m)}</b>
                <small>{t(`mode.${m}.desc`)}</small>
              </span>
            </button>
          {/each}
        </div>
        {#if usesUpstream}
          <div class="row sub">
            <div class="lab">
              <b>{t('set.upstream')}</b>
              <small>{t('set.upstreamHelp')}</small>
            </div>
            <div class="ctl wide">
              <input class="input mono" class:invalid={!upstreamValid} bind:value={form.upstream} placeholder="http://127.0.0.1:11434/v1" />
              <div class="status">
                {#if !upstreamSaved}
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
          </div>
          {#if portClash}<div class="warn">{t('set.portClash', { port: form.port })}</div>{/if}
        {/if}
      </div>
    </section>

    <!-- Connection ------------------------------------------------------------------ -->
    <section class="sec" id="sec-connection">
      <h3>{t('set.sec.connection')} <span class="applies">{t(APPLIES.all)}</span></h3>
      <p class="desc">{t('set.sec.connection.desc')}</p>
      <div class="card rows">
        <div class="row">
          <div class="lab"><b>{t('set.host')}</b><small>{t('set.hostHelp')}</small></div>
          <div class="ctl"><input class="input mono" bind:value={form.host} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.port')}</b><small>{t('set.portHelp')}</small></div>
          <div class="ctl"><input class="input mono" type="number" min="1" max="65535" bind:value={form.port} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.cors')}</b><small>{t('set.corsHelp')}</small></div>
          <div class="ctl"><input class="input mono" bind:value={form.cors} placeholder={t('set.corsDisabled')} /></div>
        </div>
      </div>
    </section>

    <!-- Capacity -------------------------------------------------------------------- -->
    <section class="sec" id="sec-capacity">
      <h3>{t('set.sec.capacity')} <span class="applies">{t(APPLIES.all)}</span></h3>
      <p class="desc">{t('set.sec.capacity.desc')}</p>
      <div class="card rows">
        <div class="row">
          <div class="lab"><b>{t('set.parallel')}</b><small>OLLAMA_NUM_PARALLEL</small></div>
          <div class="ctl"><input class="input" type="number" min="1" max="64" bind:value={form.numParallel} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.maxQueue')}</b><small>{t('set.maxQueueHelp')}</small></div>
          <div class="ctl"><input class="input" type="number" min="0" bind:value={form.maxQueue} /></div>
        </div>
      </div>
    </section>

    <!-- Mock replies ---------------------------------------------------------------- -->
    <section class="sec" id="sec-replies">
      <h3>{t('set.sec.replies')} <span class="applies">{t(APPLIES.mock)}</span></h3>
      <p class="desc">{t('set.sec.replies.desc')}</p>
      {#if !usesMock}<div class="note">{t('set.notInProxy')}</div>{/if}
      <fieldset class="card rows" disabled={!usesMock}>
        <div class="group">{t('set.speed')}</div>
        <div class="presets">
          {#each store.presets as p (p.id)}
            <button class="preset" class:on={presetOn(p)} onclick={() => usePreset(p)}>
              <b>{tOr(`preset.${p.id}.label`, p.label)}</b>
              <span class="mono">{p.values.ttftMs}ms · {p.values.tps || '∞'} tok/s</span>
              <small>{tOr(`preset.${p.id}.desc`, p.description)}</small>
            </button>
          {/each}
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.ttft')}</b></div>
          <div class="ctl"><input class="input" type="number" min="0" bind:value={form.ttftMs} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.tps')}</b><small>{t('set.tpsHelp')}</small></div>
          <div class="ctl"><input class="input" type="number" min="0" step="any" bind:value={form.tps} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.jitter', { n: Math.round(form.jitter * 100) })}</b></div>
          <div class="ctl"><input type="range" min="0" max="1" step="0.05" bind:value={form.jitter} class="range" /></div>
        </div>

        <div class="group">{t('set.content')}</div>
        <div class="row">
          <div class="lab"><b>{t('set.seed')}</b><small>{t('set.seedHelp')}</small></div>
          <div class="ctl"><input class="input mono" bind:value={seedText} placeholder={t('set.seedRandom')} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.rulesFile')}</b><small>{t('set.rulesFileHelp', { path: store.rulesPath })}</small></div>
          <div class="ctl"><input class="input mono" bind:value={form.rulesPath} /></div>
        </div>

        <div class="group">{t('set.modelsGroup')}</div>
        <div class="row">
          <div class="lab"><b>{t('set.models')}</b><small>{t('set.modelsHelp')}</small></div>
          <div class="ctl wide"><textarea class="textarea mono" rows="2" bind:value={modelsText}></textarea></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.strictLabel')}</b><small>{t('set.strict')}</small></div>
          <div class="ctl"><input class="switch" type="checkbox" role="switch" aria-label={t('set.strictLabel')} bind:checked={form.strictModels} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.loadMs')}</b><small>{t('set.loadMsHelp')}</small></div>
          <div class="ctl"><input class="input" type="number" min="0" bind:value={form.loadMs} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.keepAlive')}</b></div>
          <div class="ctl"><input class="input" type="number" min="0" bind:value={form.keepAliveSec} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.pullMs')}</b></div>
          <div class="ctl"><input class="input" type="number" min="0" bind:value={form.pullMs} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.version')}</b><small>{t('set.versionHelp')}</small></div>
          <div class="ctl"><input class="input mono" bind:value={form.version} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.embedDim')}</b></div>
          <div class="ctl"><input class="input" type="number" min="1" max="8192" bind:value={form.embedDim} /></div>
        </div>
      </fieldset>
    </section>

    <!-- Recordings ------------------------------------------------------------------ -->
    <section class="sec" id="sec-recordings">
      <h3>
        {t('set.sec.recordings')}
        {#if store.config?.record && store.config.mode !== 'mock'}<span class="chip red">● REC</span>{/if}
      </h3>
      <p class="desc">{t('set.sec.recordings.desc')}</p>
      <div class="card rows">
        <div class="row" class:off={!usesUpstream}>
          <div class="lab">
            <b>{t('set.recordLabel')} <span class="applies">{t(APPLIES.upstream)}</span></b>
            <small>{usesUpstream ? t('set.recordHelp') : t('set.onlyIn', { modes: t('set.modesJoin', { a: modeLabel('proxy'), b: modeLabel('mixed') }) })}</small>
          </div>
          <div class="ctl"><input class="switch" type="checkbox" role="switch" aria-label={t('set.recordLabel')} disabled={!usesUpstream} bind:checked={form.record} /></div>
        </div>
        <div class="row" class:off={!usesMock}>
          <div class="lab">
            <b>{t('set.replayLabel')} <span class="applies">{t(APPLIES.mock)}</span></b>
            <small>{usesMock ? t('set.replayHelp') : t('set.onlyIn', { modes: t('set.modesJoin', { a: modeLabel('mock'), b: modeLabel('mixed') }) })}</small>
          </div>
          <div class="ctl"><input class="switch" type="checkbox" role="switch" aria-label={t('set.replayLabel')} disabled={!usesMock} bind:checked={form.replay} /></div>
        </div>
        <div class="row">
          <div class="lab"><b>{t('set.recordingsFile')}</b><small>{t('set.recordingsFileHelp', { path: store.recordingsPath, n: store.recordings.length })} {t('set.recordingsHelp')}</small></div>
          <div class="ctl"><input class="input mono" bind:value={form.recordingsPath} /></div>
        </div>
      </div>
    </section>

    <!-- The settings file ----------------------------------------------------------- -->
    <section class="sec" id="sec-file">
      <h3>{t('set.sec.file')}</h3>
      <p class="desc"><Rich text={t('set.sec.file.desc', { path: store.envPath })} /></p>
      <div class="card body">
        <div class="filehead">
          <span class="muted small">{t('set.envPreview')}</span>
          <span class="grow"></span>
          <button class="btn sm ghost" title={t('set.copyEnv')} aria-label={t('set.copyEnv')} onclick={() => store.copy(preview, t('set.envCopied'))}><Icon name="copy" size={12} /></button>
        </div>
        <pre class="env">{preview}</pre>
      </div>
    </section>

    <!-- Save: only while there is something to save ----------------------------------- -->
    {#if dirty}
      <div class="savebar" role="status">
        <Icon name="save" size={14} />
        <span class="grow">
          {t('set.unsaved')}
          {#if restartNeeded}<span class="restart">{t('set.unsavedRestart')}</span>{/if}
        </span>
        <button class="btn" onclick={revert}><Icon name="undo" size={13} />{t('common.revert')}</button>
        <button class="btn primary" onclick={save} disabled={saving}>
          <Icon name="save" size={13} />{restartNeeded ? t('set.saveRestart') : t('common.save')}
          <kbd>Ctrl+S</kbd>
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    height: 100%;
  }
  .toc {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 70px 10px 0 14px;
    border-right: 1px solid var(--line);
  }
  .toc button {
    text-align: left;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    font-size: 12.5px;
  }
  .toc button:hover {
    background: var(--panel);
    color: var(--text);
  }
  .toc button.on {
    background: var(--panel-2);
    color: var(--text);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .scroll {
    overflow: auto;
    padding: 18px 24px 0;
    scroll-padding-top: 12px;
  }
  .sec {
    max-width: 880px;
    margin-bottom: 28px;
  }
  .sec h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    margin: 0 0 2px;
  }
  .desc {
    margin: 0 0 10px;
    color: var(--muted);
    font-size: 12px;
  }
  .applies {
    font: 500 10.5px var(--font);
    padding: 1px 7px;
    border-radius: 9px;
    background: var(--panel-2);
    border: 1px solid var(--line-2);
    color: var(--muted);
  }
  .card.body {
    padding: 12px 14px;
  }
  fieldset.card {
    margin: 0;
    min-width: 0;
  }
  fieldset:disabled {
    opacity: 0.5;
  }
  .rows {
    padding: 0 14px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 11px 0;
    border-top: 1px solid var(--line);
  }
  .rows > .row:first-child,
  .rows > .group:first-child + .presets + .row,
  .group + .row {
    border-top: 0;
  }
  .row.off .lab {
    opacity: 0.55;
  }
  .row.sub {
    border-top: 1px solid var(--line);
    margin-top: 12px;
    padding-bottom: 0;
    align-items: flex-start;
  }
  .lab {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .lab b {
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lab small {
    color: var(--muted);
    font-size: 11.5px;
    line-height: 1.45;
    /* Long file paths wrap instead of running out of the row. */
    overflow-wrap: anywhere;
  }
  .ctl {
    width: 260px;
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
  }
  .ctl .input,
  .ctl .textarea {
    width: 100%;
  }
  .ctl.wide {
    width: 420px;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .status .chip {
    white-space: normal;
    height: auto;
    min-height: 22px;
  }
  .group {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    padding: 14px 0 4px;
    border-top: 1px solid var(--line);
  }
  .rows > .group:first-child {
    border-top: 0;
  }
  .modes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .choice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--line-2);
    background: var(--bg-2);
    text-align: left;
    cursor: pointer;
  }
  .choice b {
    display: block;
    margin-bottom: 2px;
  }
  .choice small {
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
  }
  .choice:hover {
    border-color: var(--muted);
  }
  .choice.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .radio {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin-top: 2px;
    border-radius: 50%;
    border: 2px solid var(--line-2);
  }
  .choice.on .radio {
    border-color: var(--accent);
    background: radial-gradient(var(--accent) 45%, transparent 50%);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    padding: 4px 0 10px;
  }
  .preset {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
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
    font-size: 10.5px;
    line-height: 1.35;
  }
  .range {
    width: 100%;
    accent-color: var(--accent);
  }
  .note,
  .warn {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    margin-bottom: 10px;
  }
  .note {
    background: color-mix(in srgb, var(--violet) 12%, transparent);
    color: var(--violet);
  }
  .warn {
    margin: 12px 0 0;
    background: var(--amber-soft);
    color: var(--amber);
  }
  /* A switch: a checkbox drawn as a track and a knob. */
  .switch {
    appearance: none;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    background: var(--line-2);
    position: relative;
    cursor: pointer;
    transition: background 0.15s;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch:checked {
    background: var(--accent);
  }
  .switch:checked::after {
    transform: translateX(14px);
  }
  .switch:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .choice:focus-visible,
  .switch:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .filehead {
    display: flex;
    align-items: center;
    margin-bottom: 6px;
  }
  .small {
    font-size: 11px;
  }
  .env {
    max-height: 260px;
    overflow: auto;
    font-size: 11px;
    color: var(--text-2);
  }
  .savebar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 880px;
    margin: 0 0 14px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line-2));
    background: var(--panel-3);
    box-shadow: var(--shadow);
    animation: rise 0.15s ease-out;
  }
  .restart {
    display: block;
    font-size: 11px;
    color: var(--amber);
  }
  kbd {
    font: 500 10px var(--mono);
    opacity: 0.7;
    margin-left: 4px;
  }
  @keyframes rise {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
</style>
