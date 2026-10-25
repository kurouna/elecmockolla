/**
 * Deep value comparison that ignores the order of object keys, and treats a missing key
 * and an explicit `undefined` as the same unset field.
 *
 * The editing pages compare their draft against what main stored to tell whether there are
 * unsaved edits, and an answer of "yes" holds page switches back. Comparing JSON text makes
 * that answer depend on things the user cannot see: the editors drop an optional field
 * (`delete r.fault`) and set it again, main rebuilds the object in `normalizeRules`' own key
 * order, and `Settings.current()` assembles a fresh object on every call. Equal values in a
 * different order must not read as an edit.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => sameData(v, b[i]))
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (!sameData(x[k], y[k])) return false
  }
  return true
}
