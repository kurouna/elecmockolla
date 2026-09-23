import { pick, type Rng, randInt } from './random.ts'

const EN_WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut ' +
  'labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris ' +
  'nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse ' +
  'cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui ' +
  'officia deserunt mollit anim id est laborum perspiciatis unde omnis iste natus error ' +
  'voluptatem accusantium doloremque laudantium totam rem aperiam eaque ipsa quae ab illo ' +
  'inventore veritatis quasi architecto beatae vitae dicta explicabo nemo ipsam quia voluptas ' +
  'aspernatur aut odit fugit consequuntur magni dolores eos ratione sequi nesciunt neque porro ' +
  'quisquam dolorem adipisci numquam eius modi tempora incidunt magnam quaerat'
).split(' ')

const JA_NOUNS = [
  'システム',
  'データ',
  '設定',
  '処理',
  '結果',
  '画面',
  '機能',
  '情報',
  '時間',
  '方法',
  '利用者',
  '環境',
  '構成',
  '仕組み',
  '応答',
  '内容',
  '接続',
  '動作',
  '状態',
  '記録',
  'モデル',
  'サーバー',
  '手順',
  '入力',
  '出力',
]
const JA_PREDICATES = [
  'を確認します',
  'が変わります',
  'について説明します',
  'を更新しました',
  'に影響します',
  'が必要です',
  'を表示できます',
  'として扱われます',
  'を整理しておきます',
  'が安定しています',
  'を見直すと良いでしょう',
  'に注意してください',
  'を順番に進めます',
  'はすでに準備できています',
]
const JA_OPENERS = ['まず、', 'また、', 'さらに、', '一方で、', 'つまり、', 'なお、', '次に、', '']

/** English lorem ipsum, `words` long, split into sentences. */
export function loremEn(rng: Rng, words: number): string {
  const sentences: string[] = []
  let left = Math.max(1, words)
  while (left > 0) {
    const n = Math.min(left, randInt(rng, 6, 14))
    const ws = Array.from({ length: n }, () => pick(rng, EN_WORDS))
    const first = ws[0] ?? 'lorem'
    ws[0] = first.charAt(0).toUpperCase() + first.slice(1)
    // An occasional comma reads more naturally in a streamed reply.
    if (n > 8) ws[randInt(rng, 3, n - 3)] += ','
    sentences.push(`${ws.join(' ')}.`)
    left -= n
  }
  return sentences.join(' ')
}

/** Plausible-looking Japanese filler. One "word" is one noun or predicate unit. */
export function loremJa(rng: Rng, words: number): string {
  let out = ''
  let left = Math.max(1, words)
  while (left > 0) {
    const nouns = rng() < 0.5 ? 1 : 2
    const subject =
      nouns === 1 ? pick(rng, JA_NOUNS) : `${pick(rng, JA_NOUNS)}の${pick(rng, JA_NOUNS)}`
    out += `${pick(rng, JA_OPENERS)}${subject}${pick(rng, JA_PREDICATES)}。`
    left -= nouns + 1
  }
  return out
}

const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/

export const hasJapanese = (s: string): boolean => JAPANESE.test(s)

export function lorem(rng: Rng, words: number, lang: 'auto' | 'en' | 'ja', hint = ''): string {
  const ja = lang === 'ja' || (lang === 'auto' && hasJapanese(hint))
  return ja ? loremJa(rng, words) : loremEn(rng, words)
}

/**
 * Split text into token-sized pieces the way a BPE tokenizer roughly would:
 * short Latin word pieces with their leading space, 1-2 CJK characters, single
 * symbols. `tokenize(s).join('') === s` always holds.
 */
const TOKEN = /\s*(?:[A-Za-z]{1,6}|\d{1,3}|[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]{1,2}|[\s\S])/gu

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? []
}

export const countTokens = (text: string): number => tokenize(text).length
