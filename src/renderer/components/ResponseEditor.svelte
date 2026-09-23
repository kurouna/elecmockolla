<script lang="ts">
import type { ResponseSpec } from '../../shared/types.ts'
import { t } from '../lib/i18n.svelte.ts'

/** Edits one reply spec: used by rules and by the fallback. */
let { spec = $bindable(), regex = false }: { spec: ResponseSpec; regex?: boolean } = $props()

const KINDS: ResponseSpec['kind'][] = ['template', 'lorem', 'json', 'tool', 'echo']

let jsonError = $derived.by(() => {
  if (spec.kind !== 'json' && spec.kind !== 'tool') return ''
  // Placeholders make the template invalid JSON until they are filled in, so test a filled copy.
  const probe = (spec.text || '{}')
    .replace(/\{\{int:[^}]*\}\}/g, '1')
    .replace(/\{\{[^}]*\}\}/g, 'x')
    .replace(/\$(<\w+>|\d{1,2}|&)/g, 'x')
  try {
    JSON.parse(probe)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
})
</script>

<div class="re">
  <div class="kinds">
    {#each KINDS as k (k)}
      <button class="kind" class:on={spec.kind === k} onclick={() => (spec.kind = k)} title={t(`re.${k}.hint`)}>{t(`re.${k}`)}</button>
    {/each}
  </div>

  {#if spec.kind === 'template'}
    <label class="field">
      <span>{t('common.reply')}</span>
      <textarea class="textarea mono" rows="6" bind:value={spec.text}></textarea>
    </label>
  {:else if spec.kind === 'lorem'}
    <div class="three">
      <label class="field">
        <span>{t('re.language')}</span>
        <select class="select" bind:value={spec.lang}>
          <option value="auto">{t('re.langAuto')}</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
        </select>
      </label>
      <label class="field"><span>{t('re.minWords')}</span><input class="input" type="number" min="1" bind:value={spec.minWords} /></label>
      <label class="field"><span>{t('re.maxWords')}</span><input class="input" type="number" min="1" bind:value={spec.maxWords} /></label>
    </div>
  {:else if spec.kind === 'json'}
    <label class="field">
      <span>{t('re.jsonTemplate')}</span>
      <textarea class="textarea mono" class:invalid={jsonError} rows="8" bind:value={spec.text}></textarea>
      {#if jsonError}<small class="bad">{t('re.invalidJson', { error: jsonError })}</small>{/if}
    </label>
  {:else if spec.kind === 'tool'}
    <label class="field"><span>{t('re.functionName')}</span><input class="input mono" bind:value={spec.toolName} placeholder="get_weather" /></label>
    <label class="field">
      <span>{t('re.arguments')}</span>
      <textarea class="textarea mono" class:invalid={jsonError} rows="4" bind:value={spec.text}></textarea>
      {#if jsonError}<small class="bad">{t('re.invalidJson', { error: jsonError })}</small>{/if}
    </label>
  {:else}
    <p class="muted">{t('re.echoNote')}</p>
  {/if}

  {#if spec.kind !== 'echo'}
    <label class="field">
      <span>{t('common.thinking')} <span class="muted">{t('re.thinkNote')}</span></span>
      <input class="input mono" bind:value={spec.think} placeholder={t('re.thinkPlaceholder')} />
    </label>
  {/if}

  <details class="help">
    <summary>{t('re.placeholders')}</summary>
    <div class="ph mono">
      {#if regex}<span><b>$1 … $99</b> {t('re.ph.groups')}</span><span><b>$&lt;name&gt;</b> {t('re.ph.named')}</span><span><b>$&amp;</b> {t('re.ph.whole')}</span>{/if}
      <span><b>{'{{prompt}}'}</b> {t('re.ph.prompt')}</span>
      <span><b>{'{{model}}'}</b> {t('re.ph.model')}</span>
      <span><b>{'{{lorem:N}}'}</b> {t('re.ph.lorem')}</span>
      <span><b>{'{{lorem-ja:N}}'}</b> {t('re.ph.loremJa')}</span>
      <span><b>{'{{int:1-100}}'}</b> {t('re.ph.int')}</span>
      <span><b>{'{{pick:a|b|c}}'}</b> {t('re.ph.pick')}</span>
      <span><b>{'{{calc:$1+$2}}'}</b> {t('re.ph.calc')}</span>
      <span><b>{'{{uuid}}'}</b> <b>{'{{date}}'}</b> <b>{'{{time}}'}</b> <b>{'{{now}}'}</b> <b>{'{{n}}'}</b></span>
      <span><b>$$</b> {t('re.ph.dollar')}</span>
    </div>
  </details>
</div>

<style>
  .re {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .kind {
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    border: 1px solid var(--line-2);
    background: var(--bg-2);
    cursor: pointer;
    font-size: 12px;
  }
  .kind.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .three {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 10px;
  }
  .bad {
    color: var(--red) !important;
  }
  .help summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 12px;
  }
  .ph {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px 16px;
    margin-top: 8px;
    font-size: 11px;
    color: var(--text-2);
  }
  .ph b {
    color: var(--accent);
    font-weight: 500;
  }
</style>
