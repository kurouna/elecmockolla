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
  ['今、何時？', 'time-ja'],
  ['いま なんじ？', 'time-ja'],
  ['今日の日付は？', 'time-ja'],
  ['今日は何日？', 'time-ja'],
  ['今日、何曜日？', 'time-ja'],
  ['現在の時刻を教えて', 'time-ja'],
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
  // Small talk.
  ['テスト', 'ping-ja'],
  ['もしもし', 'ping-ja'],
  ['test', 'ping-en'],
  ['Are you there?', 'ping-en'],
  ['ごめんなさい', 'sorry-ja'],
  ['Sorry about that', 'sorry-en'],
  ['すごい！', 'praise-ja'],
  ['助かりました、ありがとう', 'praise-ja'],
  ["You're awesome", 'praise-en'],
  ['www', 'laugh-ja'],
  ['（笑）', 'laugh-ja'],
  ['lol', 'laugh-en'],
  ['暇だなあ', 'bored-ja'],
  ["I'm bored", 'bored-en'],
  ['お腹すいた', 'hungry-ja'],
  ['今日の晩ごはん何にしよう', 'hungry-ja'],
  ['What should I eat for dinner?', 'hungry-en'],
  ['眠い…', 'sleepy-ja'],
  ["I can't sleep", 'sleepy-en'],
  ['最近ちょっと落ち込んでて', 'sad-ja'],
  ["I'm feeling down today", 'sad-en'],
  ['試験に合格した！', 'happy-ja'],
  ['I got the job!', 'happy-en'],
  ['今日は誕生日なんだ', 'birthday-ja'],
  ["It's my birthday today", 'birthday-en'],
  ['やる気が出ない', 'encourage-ja'],
  ['Cheer me up', 'encourage-en'],
  ['あなたは人間ですか？', 'human-ja'],
  ['Are you a bot?', 'human-en'],
  ['あなたのことが好き', 'love-ja'],
  ['I love you', 'love-en'],
  ['好きな食べ物は？', 'favorite-ja'],
  ["What's your favorite color?", 'favorite-en'],
  ['サイコロを振って', 'dice-ja'],
  ['Roll a die', 'dice-en'],
  ['コイントスして', 'coin-ja'],
  ['Heads or tails?', 'coin-en'],
  ['何か豆知識を教えて', 'trivia-ja'],
  ['Tell me a fun fact', 'trivia-en'],
  ['いただきます', 'meal-ja'],
  ['Bon appetit', 'meal-en'],
  ['行ってきます', 'leaving-ja'],
  ["I'm heading out", 'leaving-en'],
  // More greetings.
  ['やっほー', 'hey-ja'],
  ["What's up", 'hey-en'],
  ['よろしくお願いします', 'yoroshiku-ja'],
  ["Let's get started", 'yoroshiku-en'],
  ['お久しぶりです', 'longtime-ja'],
  ['Long time no see', 'longtime-en'],
  ['おかえりなさい', 'welcomeback-ja'],
  ['Welcome back!', 'welcomeback-en'],
  ['あけましておめでとう', 'newyear-ja'],
  ['Happy New Year!', 'newyear-en'],
  ['メリークリスマス', 'xmas-ja'],
  ['Merry Christmas', 'xmas-en'],
  // What people type to test a chat.
  ['OKとだけ返事して', 'say-ok-ja'],
  ['Reply with just OK', 'say-ok-en'],
  ['「おはよう」と言って', 'repeat-ja'],
  ['Repeat after me: "hello there"', 'repeat-en'],
  ['ほげほげ', 'dummy-ja'],
  ['asdf', 'dummy-en'],
  ['1+1は？', 'math-ja'],
  ['What is 7*6?', 'math-en'],
  ['10まで数えて', 'count-ja'],
  ['Count to ten', 'count-en'],
  ['あいうえおを言って', 'alphabet-ja'],
  ['Say the alphabet', 'alphabet-en'],
  // What a kindergartner knows.
  ['空は何色？', 'color-sky-ja'],
  ['What color is the sky?', 'color-sky-en'],
  ['りんごは何色？', 'color-apple-ja'],
  ['バナナって何色？', 'color-banana-ja'],
  ['雪は何色？', 'color-snow-ja'],
  ['虹は何色？', 'rainbow-ja'],
  ['What are the colors of the rainbow?', 'rainbow-en'],
  ['信号の色は？', 'traffic-light-ja'],
  ['犬は何て鳴く？', 'animal-dog-ja'],
  ['猫の鳴き声は？', 'animal-cat-ja'],
  ['What does a cow say?', 'animal-cow-en'],
  ['カエルはなんて鳴くの？', 'animal-frog-ja'],
  ['虫の足は何本？', 'legs-insect-ja'],
  ['How many legs does a spider have?', 'legs-spider-en'],
  ['タコの足は何本？', 'legs-octopus-ja'],
  ['1週間は何日？', 'week-ja'],
  ['How many days are in a week?', 'week-en'],
  ['1年は何か月？', 'year-ja'],
  ['季節はいくつ？', 'seasons-ja'],
  ['指は何本？', 'fingers-ja'],
  ['太陽はどっちから昇る？', 'sun-ja'],
  ['Where does the sun rise?', 'sun-en'],
  // The rules that were there before keep their prompts.
  ['hello', 'greeting'],
  ['my name is Kurouna', 'name'],
  ['東京の天気は？', 'weather-tool'],
  ['明日の天気は？', 'weather-ja'],
  ['今日は傘いる？', 'weather-ja'],
  ["What's the weather like tomorrow?", 'weather-en'],
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
      // translate-ja asks for English; say-ok-ja asks for the one word OK.
      if (!rule.endsWith('-ja') || rule === 'translate-ja' || rule === 'say-ok-ja') continue
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
