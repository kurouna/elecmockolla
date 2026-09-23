<script lang="ts">
import { onMount } from 'svelte'
import { missingFrom, takeFrom } from '../../core/rules-merge.ts'
import type { FaultMode, Rule, RulesFile, TestResult } from '../../shared/types.ts'
import Icon from '../components/Icon.svelte'
import Recordings from '../components/Recordings.svelte'
import ResponseEditor from '../components/ResponseEditor.svelte'
import Rich from '../components/Rich.svelte'
import { matchLabel } from '../lib/format.ts'
import { t } from '../lib/i18n.svelte.ts'
import { store } from '../lib/state.svelte.ts'

const api = window.mockolla

// A deep, editable copy of the saved rules. Saving validates in main.
const clone = (r: RulesFile | null): RulesFile =>
  r
    ? structuredClone($state.snapshot(r))
    : {
        version: 1,
        rules: [],
        keywords: [],
        fallback: { kind: 'lorem', text: '', lang: 'auto', minWords: 20, maxWords: 60 },
      }

const initial = clone(store.rules)
let draft = $state<RulesFile>(initial)
let tab = $state<'rules' | 'keywords' | 'fallback' | 'recordings'>('rules')
let selId = $state<string | null>(initial.rules[0]?.id ?? null)
let testPrompt = $state('')
let testModel = $state('llama3.2:3b')
let result = $state<TestResult | null>(null)
/** Only the newest test answer is shown; an older one arriving late is dropped. */
let testSeq = 0

// --- search and filter (the list only: numbering, order and moving stay on the full list)
let query = $state('')
let only = $state<'all' | 'on' | 'off'>('all')
const q = $derived(query.trim().toLowerCase())
const shown = $derived(
  draft.rules.filter((r) => {
    if (only === 'on' && !r.enabled) return false
    if (only === 'off' && r.enabled) return false
    if (!q) return true
    return `${r.name} ${r.id} ${r.match.pattern} ${r.match.model ?? ''} ${r.response.text} ${r.response.toolName ?? ''}`
      .toLowerCase()
      .includes(q)
  }),
)
const filtering = $derived(q !== '' || only !== 'all')
/** Turns every rule the filter shows on or off: e.g. search "elec", then all on. */
function setShown(enabled: boolean) {
  for (const r of shown) r.enabled = enabled
}
let kwQuery = $state('')
const kwShown = $derived.by(() => {
  const f = kwQuery.trim().toLowerCase()
  return f
    ? draft.keywords.filter((k) => `${k.keyword} ${k.reply}`.toLowerCase().includes(f))
    : draft.keywords
})

// --- built-in rules added or updated in a newer version, not yet offered to this file
let defaults = $state.raw<RulesFile | null>(null)
void api.defaultRules().then((d) => {
  defaults = d
})
const offer = $derived(defaults ? missingFrom($state.snapshot(draft) as RulesFile, defaults) : null)
const offerCount = $derived(
  offer ? offer.rules.length + offer.keywords.length + offer.updated.length : 0,
)
function takeOffer(add: boolean) {
  if (!defaults) return
  const n = offerCount
  draft = takeFrom($state.snapshot(draft) as RulesFile, add, defaults)
  store.flash(add ? t('rules.newAdded', { n }) : t('rules.newSkipped'), 'info')
}

const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(store.rules))

// Follow outside changes (the control API) while the draft is untouched.
let rulesBase = JSON.stringify(store.rules)
$effect(() => {
  const next = JSON.stringify(store.rules)
  if (next !== rulesBase && JSON.stringify($state.snapshot(draft)) === rulesBase) {
    draft = clone(store.rules)
    if (!draft.rules.some((r) => r.id === selId)) selId = draft.rules[0]?.id ?? null
  }
  rulesBase = next
})

// Leaving with unsaved edits asks first.
onMount(() => {
  store.leaveGuard = () => !dirty || confirm(t('common.discard'))
  return () => {
    store.leaveGuard = null
  }
})
const sel = $derived(draft.rules.find((r) => r.id === selId))

function regexError(pattern: string, flags = ''): string {
  try {
    new RegExp(pattern, flags.replace('g', ''))
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Live test against the draft, so edits can be tried before saving.
$effect(() => {
  const input = { prompt: testPrompt, model: testModel }
  const rules = $state.snapshot(draft)
  const seq = ++testSeq
  // Nothing typed, nothing to try: no result and no highlighted rule.
  if (!input.prompt.trim()) {
    result = null
    return
  }
  const t = setTimeout(async () => {
    const r = await api.testRules(input, rules)
    if (seq === testSeq) result = r
  }, 150)
  return () => clearTimeout(t)
})

function uniqueId(base: string, taken: string[]): string {
  let id = base
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`
  return id
}

function addRule() {
  const id = uniqueId(
    'rule',
    draft.rules.map((r) => r.id),
  )
  const rule: Rule = {
    id,
    name: t('rules.newRule'),
    enabled: true,
    match: { kind: 'regex', pattern: '^ping\\b', flags: 'i' },
    response: { kind: 'template', text: 'pong ({{model}})' },
  }
  draft.rules.unshift(rule)
  selId = id
}

function duplicate(r: Rule) {
  const copy = structuredClone($state.snapshot(r))
  copy.id = uniqueId(
    r.id,
    draft.rules.map((x) => x.id),
  )
  copy.name = t('rules.copyOf', { name: r.name })
  draft.rules.splice(draft.rules.indexOf(r) + 1, 0, copy)
  selId = copy.id
}

function remove(r: Rule) {
  const i = draft.rules.indexOf(r)
  draft.rules.splice(i, 1)
  selId = draft.rules[Math.min(i, draft.rules.length - 1)]?.id ?? null
}

function move(r: Rule, d: number) {
  const i = draft.rules.indexOf(r)
  const j = i + d
  if (j < 0 || j >= draft.rules.length) return
  const [x] = draft.rules.splice(i, 1)
  if (x) draft.rules.splice(j, 0, x)
}

function addKeyword() {
  draft.keywords.push({
    id: uniqueId(
      'kw',
      draft.keywords.map((k) => k.id),
    ),
    enabled: true,
    keyword: '',
    reply: '',
  })
}

async function save() {
  if (await store.saveRules($state.snapshot(draft))) draft = clone(store.rules)
}

function revert() {
  draft = clone(store.rules)
  if (!draft.rules.some((r) => r.id === selId)) selId = draft.rules[0]?.id ?? null
}

async function resetDefaults() {
  draft = await api.defaultRules()
  selId = draft.rules[0]?.id ?? null
  store.flash(t('rules.defaultsLoaded'), 'info')
}

function setFault(r: Rule, v: string) {
  if (v) r.fault = v as FaultMode
  else delete r.fault
  if (r.fault !== 'error500') delete r.status
}
function setStatus(r: Rule, v: string) {
  if (v.trim()) r.status = v.trim()
  else delete r.status
}
function setNum(r: Rule, key: 'ttftMs' | 'tps', v: string) {
  if (v === '') delete r[key]
  else r[key] = Math.max(0, Number(v))
}

const hitId = $derived(result?.match.source === 'rule' ? result.match.id : null)
</script>

<div class="wrap">
  <div class="top">
    <div class="seg">
      <button class:on={tab === 'rules'} onclick={() => (tab = 'rules')}>{t('rules.tab.rules')} <em>{draft.rules.length}</em></button>
      <button class:on={tab === 'keywords'} onclick={() => (tab = 'keywords')}>{t('rules.tab.keywords')} <em>{draft.keywords.length}</em></button>
      <button class:on={tab === 'fallback'} onclick={() => (tab = 'fallback')}>{t('rules.tab.fallback')}</button>
      <button class:on={tab === 'recordings'} onclick={() => (tab = 'recordings')}
        >{t('rules.tab.recordings')} <em>{store.recordings.length}</em></button
      >
    </div>
    <span class="muted order">{t('rules.order')}</span>
    <span class="grow"></span>
    <button class="btn sm ghost" onclick={resetDefaults} title={t('rules.defaultsTitle')}>{t('rules.defaults')}</button>
    <button class="btn sm" onclick={revert} disabled={!dirty}><Icon name="undo" size={13} />{t('common.revert')}</button>
    <button class="btn sm primary" onclick={save} disabled={!dirty}><Icon name="save" size={13} />{t('common.save')}{dirty ? ' *' : ''}</button>
  </div>

  {#if offer && offerCount && tab !== 'recordings'}
    <div class="note offer">
      <span class="grow">
        {t('rules.newOffer', { n: offerCount })}
        <span class="names">{[...offer.updated.map((r) => t('rules.updatedName', { name: r.name })), ...offer.rules.map((r) => r.name), ...offer.keywords.map((k) => `"${k.keyword}"`)].join(', ')}</span>
      </span>
      <button class="btn sm primary" onclick={() => takeOffer(true)}><Icon name="plus" size={12} />{t('rules.newAdd')}</button>
      <button class="btn sm ghost" onclick={() => takeOffer(false)}>{t('rules.newSkip')}</button>
    </div>
  {/if}

  {#if tab === 'recordings'}
    <!-- The recordings tab explains itself. -->
  {:else if store.config?.mode === 'proxy'}
    <div class="note warn">{t('rules.proxyNote')}</div>
  {:else if store.config?.mode === 'mixed'}
    <div class="note">{t('rules.mixedNote')}</div>
  {/if}
  {#if store.config?.replay && store.config.mode !== 'proxy' && store.recordings.length && tab !== 'recordings'}
    <div class="note">{t('rules.replayNote')}</div>
  {/if}

  {#if tab !== 'recordings'}
  <div class="tester card">
    <Icon name="flask" size={15} />
    <input class="input" bind:value={testPrompt} placeholder={t('rules.tryPrompt')} />
    <input class="input mono model" bind:value={testModel} title={t('rules.modelTitle')} />
    {#if result}
      <span class="chip {result.error ? 'red' : 'violet'}">{matchLabel(result.match)}</span>
      {#if result.match.source === 'rule' && result.match.id && result.match.id !== selId}
        <button class="btn sm ghost" onclick={() => { tab = 'rules'; selId = result?.match.id ?? null }}>{t('rules.show')}</button>
      {/if}
    {/if}
  </div>
  {#if result}
    <pre class="testout" class:bad={!!result.error}>{result.error ? `${result.error}\n` : ''}{result.toolCalls.length ? `→ ${result.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(', ')}` : result.text}</pre>
  {/if}
  {/if}

  {#if tab === 'rules'}
    <div class="split">
      <section class="card list">
        <div class="lhead">
          <div class="row">
            <button class="btn sm" onclick={addRule}><Icon name="plus" size={13} />{t('rules.add')}</button>
            <span class="grow"></span>
            <div class="seg">
              {#each ['all', 'on', 'off'] as const as o (o)}
                <button class:on={only === o} onclick={() => (only = o)}>{t(`rules.only.${o}`)}</button>
              {/each}
            </div>
          </div>
          <input class="input search" bind:value={query} placeholder={t('rules.search')} />
          {#if filtering}
            <div class="row filtered">
              <span class="muted">{t('rules.shownOf', { n: shown.length, total: draft.rules.length })}</span>
              <span class="grow"></span>
              <button class="btn sm ghost" disabled={!shown.length} onclick={() => setShown(true)}>{t('rules.allOn')}</button>
              <button class="btn sm ghost" disabled={!shown.length} onclick={() => setShown(false)}>{t('rules.allOff')}</button>
            </div>
          {/if}
        </div>
        <div class="items">
          {#each shown as r (r.id)}
            {@const i = draft.rules.indexOf(r)}
            {@const err = r.match.kind === 'regex' ? regexError(r.match.pattern, r.match.flags) : ''}
            <div class="item" class:on={r.id === selId} class:off={!r.enabled} class:hit={r.id === hitId}>
              <input type="checkbox" bind:checked={r.enabled} title={t('rules.enabled')} />
              <button class="name" onclick={() => (selId = r.id)}>
                <span class="n">{i + 1}. {r.name}</span>
                <span class="p mono" class:bad={!!err}>{r.match.kind === 'always' ? t('rules.always') : r.match.pattern}</span>
              </button>
              {#if r.fault}<span class="chip red">{r.fault === 'error500' && r.status ? t('rules.fault.error500') : t(`fault.${r.fault}`)}</span>{/if}
              {#if r.id === hitId}<span class="chip violet">{t('rules.hit')}</span>{/if}
            </div>
          {:else}
            <div class="empty">{filtering ? t('rules.noMatch') : t('rules.noRules')}</div>
          {/each}
        </div>
      </section>

      <section class="card editor">
        {#if sel}
          {@const err = sel.match.kind === 'regex' ? regexError(sel.match.pattern, sel.match.flags) : ''}
          <div class="card-body ed">
            <div class="row">
              <label class="field grow"><span>{t('common.name')}</span><input class="input" bind:value={sel.name} /></label>
              <label class="field idf"><span>ID</span><input
                  class="input mono"
                  value={sel.id}
                  onchange={(e) => {
                    const v = e.currentTarget.value.trim()
                    if (v && !draft.rules.some((r) => r.id === v)) {
                      sel.id = v
                      selId = v
                    } else e.currentTarget.value = sel.id
                  }}
                /></label>
              <div class="tools">
                <button class="btn sm icon" onclick={() => move(sel, -1)} title={t('rules.moveUp')}><Icon name="up" size={14} /></button>
                <button class="btn sm icon" onclick={() => move(sel, 1)} title={t('rules.moveDown')}><Icon name="down" size={14} /></button>
                <button class="btn sm icon" onclick={() => duplicate(sel)} title={t('rules.duplicate')}><Icon name="copy" size={13} /></button>
                <button class="btn sm icon danger" onclick={() => remove(sel)} title={t('common.delete')}><Icon name="trash" size={13} /></button>
              </div>
            </div>

            <h3>{t('rules.when')}</h3>
            <div class="when">
              <label class="field">
                <span>{t('rules.match')}</span>
                <select class="select" bind:value={sel.match.kind}>
                  <option value="regex">{t('rules.kind.regex')}</option>
                  <option value="contains">{t('rules.kind.contains')}</option>
                  <option value="always">{t('rules.kind.always')}</option>
                </select>
              </label>
              {#if sel.match.kind !== 'always'}
                <label class="field grow">
                  <span>{t('rules.pattern')}</span>
                  <input class="input mono" class:invalid={!!err} bind:value={sel.match.pattern} />
                </label>
                <label class="field flags"><span>{t('rules.flags')}</span><input class="input mono" bind:value={sel.match.flags} placeholder="i" /></label>
              {/if}
            </div>
            {#if err}<small class="bad">{err}</small>{/if}
            <div class="when">
              <label class="field">
                <span>{t('rules.lookAt')}</span>
                <select class="select" value={sel.match.target ?? 'last'} onchange={(e) => (sel.match.target = e.currentTarget.value as 'last')}>
                  <option value="last">{t('rules.target.last')}</option>
                  <option value="all">{t('rules.target.all')}</option>
                  <option value="system">{t('rules.target.system')}</option>
                </select>
              </label>
              <label class="field grow"><span>{t('rules.onlyModels')}</span><input class="input mono" bind:value={sel.match.model} placeholder={t('rules.anyModel')} /></label>
            </div>

            <h3>{t('common.reply')}</h3>
            <ResponseEditor bind:spec={sel.response} regex={sel.match.kind === 'regex'} />

            <h3>{t('rules.behaviour')}</h3>
            <div class="when">
              <label class="field"><span>{t('rules.ttft')}</span><input class="input" type="number" min="0" value={sel.ttftMs ?? ''} placeholder={t('rules.global')} oninput={(e) => setNum(sel, 'ttftMs', e.currentTarget.value)} /></label>
              <label class="field"><span>{t('rules.tps')}</span><input class="input" type="number" min="0" value={sel.tps ?? ''} placeholder={t('rules.global')} oninput={(e) => setNum(sel, 'tps', e.currentTarget.value)} /></label>
              <label class="field">
                <span>{t('rules.fault')}</span>
                <select class="select" value={sel.fault ?? ''} onchange={(e) => setFault(sel, e.currentTarget.value)}>
                  <option value="">{t('common.none')}</option>
                  <option value="error500">{t('rules.fault.error500')}</option>
                  <option value="disconnect">{t('rules.fault.disconnect')}</option>
                  <option value="hang">{t('rules.fault.hang')}</option>
                  <option value="malformed">{t('rules.fault.malformed')}</option>
                </select>
              </label>
              {#if sel.fault === 'error500'}
                <label class="field"><span>{t('rules.status')}</span><input class="input mono" value={sel.status ?? ''} placeholder="500" title={t('rules.statusHelp')} oninput={(e) => setStatus(sel, e.currentTarget.value)} /></label>
              {/if}
            </div>
          </div>
        {:else}
          <div class="empty">{t('rules.select')}</div>
        {/if}
      </section>
    </div>
  {:else if tab === 'keywords'}
    <section class="card kw">
      <div class="card-body">
        <p class="muted intro"><Rich text={t('rules.kwIntro')} /></p>
        <input class="input search" bind:value={kwQuery} placeholder={t('rules.kwSearch')} />
        <table class="grid">
          <thead>
            <tr>
              <th style="width:40px">{t('rules.kwOn')}</th><th style="width:28%">{t('rules.kwKeyword')}</th><th>{t('common.reply')}</th><th style="width:40px"></th>
            </tr>
          </thead>
          <tbody>
            {#each kwShown as k (k.id)}
              <tr class:hit={result?.match.source === 'keyword' && result.match.id === k.id}>
                <td><input type="checkbox" bind:checked={k.enabled} /></td>
                <td><input class="input mono" bind:value={k.keyword} placeholder="？" /></td>
                <td><input class="input" bind:value={k.reply} placeholder={t('rules.kwReplyText')} /></td>
                <td><button class="btn sm icon ghost" onclick={() => draft.keywords.splice(draft.keywords.indexOf(k), 1)} title={t('common.delete')}><Icon name="x" size={13} /></button></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="btn sm add" onclick={addKeyword}><Icon name="plus" size={13} />{t('rules.kwAdd')}</button>
      </div>
    </section>
  {:else if tab === 'fallback'}
    <section class="card kw">
      <div class="card-body">
        <p class="muted intro">{t('rules.fallbackIntro')}</p>
        <ResponseEditor bind:spec={draft.fallback} />
      </div>
    </section>
  {:else}
    <Recordings />
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    padding: 16px 18px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .seg em {
    font-style: normal;
    color: var(--muted);
    margin-left: 4px;
    font-size: 11px;
  }
  .order {
    font-size: 11px;
  }
  .note {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    background: color-mix(in srgb, var(--violet) 12%, transparent);
    color: var(--violet);
  }
  .note.warn {
    background: var(--amber-soft);
    color: var(--amber);
  }
  .tester {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    color: var(--muted);
  }
  .tester .model {
    width: 160px;
  }
  .testout {
    margin: -4px 0 0;
    padding: 8px 12px;
    max-height: 70px;
    overflow: auto;
    border-radius: 8px;
    background: var(--panel);
    border: 1px dashed var(--line-2);
    color: var(--text-2);
  }
  .testout.bad {
    color: var(--red);
  }
  .split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.6fr);
    gap: 12px;
  }
  .list,
  .editor,
  .kw {
    min-height: 0;
    overflow: auto;
  }
  .kw {
    flex: 1;
  }
  .list {
    display: flex;
    flex-direction: column;
  }
  .lhead {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-bottom: 1px solid var(--line);
  }
  .search {
    width: 100%;
  }
  .kw .search {
    margin-bottom: 10px;
  }
  .filtered {
    font-size: 11.5px;
  }
  .offer {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .offer .names {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    opacity: 0.85;
  }
  .items {
    overflow: auto;
    padding: 6px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 7px;
    border: 1px solid transparent;
  }
  .item input {
    accent-color: var(--accent);
  }
  .item.on {
    background: var(--panel-2);
    border-color: var(--line-2);
  }
  .item.hit {
    border-color: color-mix(in srgb, var(--violet) 60%, transparent);
  }
  .item.off .name {
    opacity: 0.45;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    text-align: left;
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 2px 0;
  }
  .name .n {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name .p {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bad {
    color: var(--red) !important;
  }
  .ed {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .ed h3 {
    margin-top: 6px;
  }
  .idf {
    width: 160px;
  }
  .tools {
    display: flex;
    gap: 4px;
    align-self: flex-end;
    padding-bottom: 3px;
  }
  .when {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }
  .when > .field:not(.grow) {
    min-width: 150px;
  }
  .flags {
    width: 80px;
    min-width: 80px !important;
  }
  .intro {
    margin: 0 0 12px;
  }
  tr.hit td {
    background: color-mix(in srgb, var(--violet) 12%, transparent);
  }
  .add {
    margin-top: 10px;
  }
</style>
