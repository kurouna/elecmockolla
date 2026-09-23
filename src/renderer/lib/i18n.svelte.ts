import { en, type Key } from './locales/en.ts'
import { ja } from './locales/ja.ts'

export type Locale = 'en' | 'ja'
export type { Key }

const DICTS: Record<Locale, Record<Key, string>> = { en, ja }
const STORAGE = 'locale'

const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ja'

/**
 * `?lang=` (set by main from MOCKOLLA_LANG, e.g. for screenshots), else the
 * user's choice, else the browser language: Japanese for `ja*`, English otherwise.
 */
function initial(): Locale {
  const q = new URLSearchParams(location.search).get('lang')
  if (isLocale(q)) return q
  try {
    const saved = localStorage.getItem(STORAGE)
    if (isLocale(saved)) return saved
  } catch {
    // Storage may be unavailable; fall through to the browser language.
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

let current = $state<Locale>(initial())
document.documentElement.lang = current

export const i18n = {
  get locale(): Locale {
    return current
  },
  set locale(l: Locale) {
    current = l
    document.documentElement.lang = l
    try {
      localStorage.setItem(STORAGE, l)
    } catch {
      // The choice still applies for this session.
    }
  },
}

/** The text for `key` in the current locale, with `{name}` replaced from `params`. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const s = DICTS[current][key] ?? en[key] ?? key
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

/** Like t(), for keys built at runtime (preset ids, states); `fallback` when missing. */
export function tOr(key: string, fallback: string, params?: Record<string, string | number>) {
  return key in en ? t(key as Key, params) : fallback
}
