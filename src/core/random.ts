/** Small deterministic helpers: every "random" choice goes through a Rng so a fixed seed reproduces a reply exactly. */

export type Rng = () => number

/** mulberry32: tiny, fast, good enough for dummy text. Returns [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over UTF-16 code units. Stable across runs and platforms. */
export function hashString(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1))

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)]
  if (item === undefined) throw new Error('pick from empty list')
  return item
}

/** A delay spread by ±jitter (0..1), never negative. */
export const jittered = (rng: Rng, ms: number, jitter: number): number =>
  Math.max(0, ms * (1 + (rng() * 2 - 1) * jitter))

export function uuid(rng: Rng): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rng() * 16).toString(16))
  hex[12] = '4'
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const s = hex.join('')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
