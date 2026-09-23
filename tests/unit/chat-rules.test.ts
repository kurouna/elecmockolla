import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine.ts'
import { defaultRules } from '../../src/core/rules.ts'
import { CASES } from './rule-cases.ts'

const engine = new Engine(defaultRules(), { seed: 5 })
const plan = (last: string) =>
  engine.plan({ model: 'llama3.2:3b', last, all: last, system: '', think: false })

describe('everyday chat rules', () => {
  it.each(CASES)('%s → %s', (prompt, rule) => {
    const p = plan(prompt)
    expect(p.match.id).toBe(rule)
    // /empty and /error answer with nothing on purpose.
    if (rule !== 'empty' && rule !== 'error')
      expect(p.text.length + p.toolCalls.length).toBeGreaterThan(0)
    expect(p.text).not.toMatch(/\{\{|\$<|\$\d/)
  })

  it('answers in the language of the prompt', () => {
    for (const [prompt, rule] of CASES) {
      // These ask for English, or for the one word OK.
      if (!rule.endsWith('-ja') || ['translate-ja', 'say-ok-ja', 'to-english-ja'].includes(rule))
        continue
      expect(plan(prompt).text, prompt).toMatch(/[぀-ヿ]/)
    }
  })

  it('fills captured words into the reply', () => {
    expect(plan('What is Kubernetes?').text).toContain('**Kubernetes**')
    expect(plan('ReactとVueの違いは？').text).toContain('| 観点 | React | Vue |')
    expect(plan('Python vs JavaScript').text).toContain('Python and JavaScript compare')
    expect(plan('How do I undo a git commit?').text).toContain('how to undo a git commit')
    expect(plan('おひつじ座の今日の運勢は？').text).toContain('**おひつじ座** の今日の運勢')
    expect(plan('Scorpio horoscope please').text).toContain('horoscope for **Scorpio**')
    expect(plan('あなたの名前は？').text).toContain('**elecmockolla**')
    expect(plan("What's your name?").text).toContain('**elecmockolla**')
    expect(plan('占いして').text).toMatch(/\*\*(大吉|中吉|小吉|吉|末吉|凶)\*\*/)
  })

  it('calls get_weather only for a place, and answers in words otherwise', () => {
    const city = (q: string) =>
      (plan(q).toolCalls[0]?.arguments as { city?: string } | undefined)?.city
    expect(city('東京の天気は？')).toBe('東京')
    expect(city('大阪の明日の天気は？')).toBe('大阪')
    expect(city('明日の大阪の天気を教えて')).toBe('大阪')
    expect(city('weather in Paris')).toBe('Paris')
    for (const q of ['明日の天気は？', '今日の天気', 'あさっての天気はどう？', '週末の天気']) {
      const p = plan(q)
      expect(p.toolCalls, q).toEqual([])
      expect(p.text, q).toContain('晴れのち雨')
    }
    expect(plan("What's the weather like tomorrow?").text).toContain('Sunny, then rain')
  })

  it('leaves requests that mention a feeling or a small-talk word to the request', () => {
    const id = (q: string) => plan(q).match.id
    expect(id('すごい雨で大変でした')).not.toBe('praise-ja')
    expect(id('猫が大好きです')).not.toBe('love-ja')
    expect(id('すみません、Pythonの使い方を教えて')).not.toBe('sorry-ja')
    expect(id('誕生日プレゼントのおすすめは？')).toBe('recommend-ja')
    expect(id('ストレステストのやり方')).toBe('howto-ja')
    expect(id('AIとは何ですか？')).toBe('explain-ja')
    expect(id('Recommend a birthday gift')).not.toBe('birthday-en')
  })

  it('answers simple questions correctly', () => {
    expect(plan('1+1は？').text).toBe('答えは **2** です。')
    expect(plan('１２×３はいくつ？').text).toContain('**36**')
    expect(plan('(2+3)*4').text).toBe('**20**')
    expect(plan('10/4').text).toBe('**2.5**')
    expect(plan('「こんにちは」と言って').text).toBe('こんにちは')
    expect(plan('Reply with just OK').text).toBe('OK')
    expect(plan('犬は何て鳴く？').text).toContain('ワンワン')
    expect(plan('What does a duck say?').text).toContain('Quack')
    expect(plan('クモの足は何本？').text).toContain('8本')
    expect(plan('空は何色？').text).toContain('青')
    expect(plan('太陽はどっちから昇る？').text).toContain('東')
  })

  it('leaves text that only looks like a test word to the other rules', () => {
    const id = (q: string) => plan(q).match.id
    expect(id('Pythonで1+1を計算して')).not.toBe('math-ja')
    expect(id('今日はどうもありがとう')).not.toBe('hey-ja')
    expect(id('foo barの違いは？')).not.toBe('dummy-en')
    expect(id('犬と猫の違いは？')).toBe('compare-ja')
  })

  it('does not take 星座 for a star sign', () => {
    expect(plan('星座占いして').match.id).toBe('fortune-ja')
    expect(plan('今日の星座占い').text).not.toContain('**星座**')
  })

  it('answers in words once the tool result is back, instead of calling the tool again', () => {
    const q = '東京の天気は？'
    const p = engine.plan({
      model: 'm',
      last: q,
      all: q,
      system: '',
      think: false,
      afterTool: true,
    })
    expect(p.toolCalls).toEqual([])
    expect(p.match.id).toBe('weather-ja')
    expect(p.text).toContain('晴れのち雨')
  })

  it('leaves plain questions to the keyword table and the rest to the fallback', () => {
    expect(plan('これは何ですか？').match.source).toBe('keyword')
    expect(plan('rivers and mountains').match.source).toBe('fallback')
  })

  it('reads only the first line, so a header line keeps a prompt out', () => {
    expect(plan('MOTION:\nWhat is Kubernetes?').match.source).not.toBe('rule')
  })
})
