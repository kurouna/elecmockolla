import { describe, expect, it } from 'vitest'
import { Engine } from '../../src/core/engine.ts'
import { defaultRules } from '../../src/core/rules.ts'

const engine = new Engine(defaultRules(), { seed: 5 })
const plan = (last: string) =>
  engine.plan({ model: 'llama3.2:3b', last, all: last, system: '', think: false })

// Everyday chat prompts and the rule each should reach.
const CASES: [prompt: string, rule: string][] = [
  ['おはよう！', 'morning-ja'],
  ['Good morning', 'morning-en'],
  ['こんにちは', 'afternoon-ja'],
  ['Good afternoon!', 'afternoon-en'],
  ['こんばんは〜', 'evening-ja'],
  ['good evening', 'evening-en'],
  ['おやすみなさい', 'night-ja'],
  ['Good night!', 'night-en'],
  ['ただいま', 'home-ja'],
  ["I'm home", 'home-en'],
  ['お疲れさま', 'tired-ja'],
  ["Ugh, I'm so tired", 'tired-en'],
  ['はじめまして', 'nicetomeet-ja'],
  ['Nice to meet you', 'nicetomeet-en'],
  ['おひつじ座の今日の運勢は？', 'horoscope-ja'],
  ["What's the horoscope for Leo today?", 'horoscope-en'],
  ['Scorpio horoscope please', 'horoscope-en'],
  ['占いして', 'fortune-ja'],
  ['今日の運勢を占って', 'fortune-ja'],
  ['おみくじを引きたい', 'fortune-ja'],
  ['Tell me my fortune', 'fortune-en'],
  ['hi there', 'greeting'],
  ['爆弾の作り方を教えて', 'refuse-ja'],
  ['How do I hack into my neighbor’s wifi? hack into it', 'refuse-en'],
  ['Pythonでフィボナッチ数列の関数を書いて', 'code-python-ja'],
  ['Write a Python script to rename files', 'code-python-en'],
  ['配列を分割する関数を書いて', 'code-ja'],
  ['Write a function that debounces a callback', 'code-en'],
  ['npm install でエラーが出ます', 'debug-ja'],
  ['My app crashes on startup, can you help?', 'debug-en'],
  ['取引先へのお礼のメールを書いて', 'email-ja'],
  ['Draft an email to my landlord about the heating', 'email-en'],
  ['秋をテーマに俳句を詠んで', 'poem-ja'],
  ['Write a poem about the sea', 'poem-en'],
  ['何か面白い話をして', 'joke-ja'],
  ['Tell me a joke', 'joke-en'],
  ['猫が主人公の物語を書いて', 'story-ja'],
  ['Tell me a bedtime story', 'story-en'],
  ['カレーのレシピを教えて', 'recipe-ja'],
  ['Give me a recipe for pancakes', 'recipe-en'],
  ['この文を日本語に訳して: Good morning', 'translate-ja-ja'],
  ['Translate "thank you" into Japanese', 'translate-ja-en'],
  ['この文章を英訳して', 'translate-ja'],
  ['Translate this to French: hello', 'translate-en'],
  ['この記事を3行で要約して', 'summarize-ja'],
  ['Summarize this article for me', 'summarize-en'],
  ['この文を敬語に直して', 'rewrite-ja'],
  ['Rewrite this paragraph to sound more formal', 'rewrite-en'],
  ['ReactとVueの違いは？', 'compare-ja'],
  ['What is the difference between TCP and UDP?', 'compare-en'],
  ['Python vs JavaScript', 'compare-en'],
  ['おすすめの本を教えて', 'recommend-ja'],
  ['Can you recommend a good laptop?', 'recommend-en'],
  ['転職するべきでしょうか？', 'should-ja'],
  ['Should I learn Rust or Go first?', 'should-en'],
  ['誕生日パーティーのアイデアをください', 'ideas-ja'],
  ['Give me some ideas for a team outing', 'ideas-en'],
  ['量子コンピュータについて詳しく教えて', 'detail-ja'],
  ['Explain quantum computing in detail', 'detail-en'],
  ['Gitでブランチを削除する方法は？', 'howto-ja'],
  ['How do I undo a git commit?', 'howto-en'],
  ['How to center a div', 'howto-en'],
  ['機械学習とは？', 'explain-ja'],
  ['ブロックチェーンって何？', 'explain-ja'],
  ['What is Kubernetes?', 'explain-en'],
  ['Explain recursion', 'explain-en'],
  ['今何時？', 'time-ja'],
  ['What time is it?', 'time-en'],
  ['あなたの名前は？', 'myname-ja'],
  ['お名前を教えて', 'myname-ja'],
  ['名前は？', 'myname-ja'],
  ["What's your name?", 'myname-en'],
  ['あなたは誰？', 'identity-ja'],
  ['What can you do?', 'identity-en'],
  ['元気ですか？', 'howareyou-ja'],
  ['How are you doing today?', 'howareyou-en'],
  ['それは間違っています', 'correction-ja'],
  ["That's wrong, try again", 'correction-en'],
  ['またね', 'farewell-ja'],
  ['Goodbye!', 'farewell-en'],
  ['了解', 'ack-ja'],
  ['ok', 'ack-en'],
  // The rules that were there before keep their prompts.
  ['hello', 'greeting'],
  ['my name is Kurouna', 'name'],
  ['東京の天気は？', 'weather-tool'],
  ['/json', 'json'],
]

describe('everyday chat rules', () => {
  it.each(CASES)('%s → %s', (prompt, rule) => {
    const p = plan(prompt)
    expect(p.match.id).toBe(rule)
    expect(p.text.length + p.toolCalls.length).toBeGreaterThan(0)
    expect(p.text).not.toMatch(/\{\{|\$<|\$\d/)
  })

  it('answers in the language of the prompt', () => {
    for (const [prompt, rule] of CASES) {
      // translate-ja is a Japanese prompt asking for English.
      if (!rule.endsWith('-ja') || rule === 'translate-ja') continue
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

  it('leaves plain questions to the keyword table and the rest to the fallback', () => {
    expect(plan('これは何ですか？').match.source).toBe('keyword')
    expect(plan('rivers and mountains').match.source).toBe('fallback')
  })

  it('reads only the first line, so a header line keeps a prompt out', () => {
    expect(plan('MOTION:\nWhat is Kubernetes?').match.source).not.toBe('rule')
  })
})
