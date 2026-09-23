/**
 * Merging newer built-in rules into a rules file. Kept apart from rules.ts, which holds
 * the built-in rules themselves: the UI imports this, and gets the defaults from main
 * over IPC, so the renderer bundle does not carry a second copy of every built-in rule.
 */
import type { KeywordEntry, Rule, RulesFile } from '../shared/types.ts'
import { EARLIER_DEFAULTS } from './earlier-defaults.ts'

export const defaultIds = (r: RulesFile): string[] => [
  ...r.rules.map((x) => x.id),
  ...r.keywords.map((k) => k.id),
]

/** JSON with sorted keys and no undefined values, so equal rules give equal text. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (typeof v === 'object' && v !== null)
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}

/**
 * What a rule says, as a short hash: everything but its id and whether it is on -
 * turning a built-in rule off is not an edit that should stop its updates.
 */
export function fingerprint(rule: Rule): string {
  const text = canonical({ ...rule, id: undefined, enabled: undefined })
  // FNV-1a, twice with different seeds: 64 bits is plenty to tell versions apart.
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x811c9dc5)
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36)
}

/** The seen-list entry for "this version of a built-in rule was offered". */
const versionKey = (rule: Rule) => `${rule.id}@${fingerprint(rule)}`

export interface Offer {
  /** Built-in rules the file does not have yet. */
  rules: Rule[]
  keywords: KeywordEntry[]
  /**
   * Built-in rules the file has as an earlier built-in version, never edited: the newer
   * version is offered in their place. A rule the user changed is left alone.
   */
  updated: Rule[]
}

/** Built-in rules and keywords a rules file has not been offered yet. */
export function missingFrom(current: RulesFile, defaults: RulesFile): Offer {
  const seen = new Set(current.seenDefaults ?? defaultIds(current))
  for (const id of defaultIds(current)) seen.add(id)
  const have = new Map(current.rules.map((r) => [r.id, r]))
  return {
    rules: defaults.rules.filter((r) => !seen.has(r.id)),
    keywords: defaults.keywords.filter((k) => !seen.has(k.id)),
    updated: defaults.rules.filter((d) => {
      const mine = have.get(d.id)
      if (!mine || seen.has(versionKey(d))) return false
      const fp = fingerprint(mine)
      return fp !== fingerprint(d) && (EARLIER_DEFAULTS[d.id] ?? []).includes(fp)
    }),
  }
}

/**
 * Offers the new built-in rules to a rules file: with `add`, new ones are put where they
 * stand among the defaults (after the nearest default before them that the file has,
 * else first), so the order still makes sense, and updated ones replace the earlier
 * version in place, staying on or off as they were; without, they are only marked as
 * seen. Either way the user's own rules and edits stay as they are.
 */
export function takeFrom(current: RulesFile, add: boolean, defaults: RulesFile): RulesFile {
  const missing = missingFrom(current, defaults)
  const rules = [...current.rules]
  if (add) {
    for (const rule of missing.updated) {
      const i = rules.findIndex((r) => r.id === rule.id)
      const old = rules[i]
      if (old) rules[i] = { ...structuredClone(rule), enabled: old.enabled }
    }
    for (const rule of missing.rules) {
      const at = defaults.rules.indexOf(rule)
      let after = -1
      for (let i = at - 1; i >= 0 && after < 0; i--) {
        const id = defaults.rules[i]?.id
        after = rules.findIndex((r) => r.id === id)
      }
      rules.splice(after + 1, 0, structuredClone(rule))
    }
  }
  const keywords = add
    ? [...current.keywords, ...missing.keywords.map((k) => ({ ...k }))]
    : [...current.keywords]
  const seen = new Set([
    ...(current.seenDefaults ?? defaultIds(current)),
    ...defaultIds(defaults),
    ...missing.updated.map(versionKey),
  ])
  return { ...current, rules, keywords, seenDefaults: [...seen] }
}
