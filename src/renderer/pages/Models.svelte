<script lang="ts">
import Icon from '../components/Icon.svelte'
import Rich from '../components/Rich.svelte'
import { fmtBytes, fmtMs } from '../lib/format.ts'
import { t } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

let adding = $state('')

const norm = (n: string) => (n.includes(':') ? n : `${n}:latest`)
const saved = $derived((store.config?.models ?? []).map(norm))
const runtime = $derived(store.snapshot?.models ?? saved)
const mode = $derived(store.config?.mode ?? 'mock')
const up = $derived(store.snapshot?.upstream ?? null)
const upModels = $derived(up?.models ?? [])
const upLoaded = $derived(new Map((up?.loaded ?? []).map((l) => [l.name, l])))
/** Models that exist only in the running server (pulled, created or copied through the API). */
const extra = $derived(runtime.filter((m) => !saved.includes(m) && !upModels.includes(m)))
const loaded = $derived(new Map((store.snapshot?.loaded ?? []).map((l) => [l.name, l.expiresAt])))
const now = $derived(store.snapshot?.now ?? Date.now())

function params(name: string): string {
  const tag = name.split(':')[1] ?? ''
  const m = /(\d+(?:\.\d+)?)([bm])/i.exec(tag)
  return m ? `${m[1]}${m[2]?.toUpperCase()}` : /embed/i.test(name) ? '137M' : '8B'
}
function caps(name: string): string[] {
  if (/embed|bge|minilm/i.test(name)) return ['embedding']
  const c = ['completion', 'tools']
  if (/qwen3|gpt-oss|r1|think|magistral/i.test(name)) c.push('thinking')
  if (/gemma3|llava|vision|vl/i.test(name)) c.push('vision')
  return c
}

/** Saves a change to the model list, applied to the list as it is when the save runs. */
function change(edit: (models: string[]) => string[]) {
  void store.updateConfig((c) => ({ models: edit(c.models) }), t('models.saved'))
}
function add() {
  const names = adding
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!names.length) return
  change((list) => [...list, ...names.filter((n) => !list.map(norm).includes(norm(n)))])
  adding = ''
}
function remove(name: string) {
  change((list) => list.filter((m) => norm(m) !== name))
}
function keep(name: string) {
  change((list) => (list.map(norm).includes(name) ? list : [...list, name]))
}
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h2>{t('nav.models')}</h2>
      <p><Rich text={t('models.intro')} /></p>
    </div>
  </div>

  {#if mode !== 'mock'}
    <section class="card upcard">
      <div class="card-head">
        <h3>{t('models.upstream')}</h3>
        <span class="muted small">{t('models.upstreamIntro', { url: store.config?.upstream ?? '' })}</span>
      </div>
      {#if up && up.checkedAt && !up.ok}
        <div class="card-body"><span class="chip red">{t('models.unreachable', { error: up.error })}</span></div>
      {:else}
        <table class="grid">
          <thead><tr><th>{t('common.name')}</th><th>{t('models.col.params')}</th><th>{t('models.col.state')}</th></tr></thead>
          <tbody>
            {#each upModels as m (m)}
              {@const l = upLoaded.get(m)}
              <tr>
                <td class="mono"><b>{m}</b></td>
                <td class="mono">{params(m)}</td>
                <td>
                  {#if l}
                    <span class="chip green"><span class="dot live"></span>{t('models.loaded')}</span>
                    <span class="muted small">{t('models.vram', { size: fmtBytes(l.sizeVram) })} · {Number.isFinite(l.expiresAt) ? t('models.unloadsIn', { t: fmtMs(l.expiresAt - now) }) : t('models.forever')}</span>
                  {:else}
                    <!-- Without /api/ps, a model not listed may still be loaded. -->
                    <span class="muted">{up?.loaded === null ? '–' : t('models.cold')}</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  {#if mode === 'mixed'}
    <div class="subhead"><h3>{t('models.mock')}</h3><span class="muted small">{t('models.mockMixed')}</span></div>
  {/if}

  {#if mode !== 'proxy'}
  <div class="bar card">
    <input class="input mono" placeholder={t('models.addPlaceholder')} bind:value={adding} onkeydown={(e) => e.key === 'Enter' && add()} />
    <button class="btn primary" onclick={add}><Icon name="plus" size={14} />{t('models.add')}</button>
    <label class="check strict">
      <input type="checkbox" checked={store.config?.strictModels} onchange={(e) => store.saveConfig({ strictModels: e.currentTarget.checked })} />
      {t('models.strict')}
    </label>
  </div>

  <section class="card">
    <table class="grid">
      <thead><tr><th>{t('common.name')}</th><th>{t('models.col.params')}</th><th>{t('models.col.caps')}</th><th>{t('models.col.state')}</th><th></th></tr></thead>
      <tbody>
        {#each [...saved, ...extra] as m (m)}
          {@const exp = loaded.get(m)}
          <tr>
            <td class="mono"><b>{m}</b>{#if extra.includes(m)} <span class="chip amber" title={t('models.runtimeTitle')}>{t('models.runtime')}</span>{/if}</td>
            <td class="mono">{params(m)}</td>
            <td>{#each caps(m) as c (c)}<span class="chip cap">{c}</span>{/each}</td>
            <td>
              {#if exp !== undefined}
                <span class="chip green"><span class="dot live"></span>{t('models.loaded')}</span>
                <span class="muted small">{exp === null || !Number.isFinite(exp) ? t('models.forever') : t('models.unloadsIn', { t: fmtMs(exp - now) })}</span>
              {:else}
                <span class="muted">{t('models.cold')}</span>
              {/if}
            </td>
            <td class="r">
              {#if extra.includes(m)}
                <button class="btn sm" onclick={() => keep(m)}>{t('models.keep')}</button>
              {:else}
                <button class="btn sm icon ghost" title={t('models.remove')} onclick={() => remove(m)}><Icon name="trash" size={13} /></button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <p class="muted note">
    <Rich text={t('models.note', { load: store.config?.loadMs ?? 0, keep: store.config?.keepAliveSec ?? 0 })} />
  </p>
  {/if}
</div>

<style>
  .upcard {
    margin-bottom: 16px;
  }
  .subhead {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0 2px 8px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    margin-bottom: 12px;
  }
  .bar .input {
    flex: 1;
  }
  .strict {
    white-space: nowrap;
    margin-left: 8px;
  }
  .cap {
    margin-right: 4px;
  }
  .small {
    font-size: 11px;
    margin-left: 6px;
  }
  .r {
    text-align: right;
  }
  .note {
    margin-top: 12px;
    font-size: 12px;
  }
</style>
