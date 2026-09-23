/**
 * The built-in rules beyond the slash commands: replies for the conversations an
 * AI chat usually has, in Japanese and English, and the ELEC system of elecdex.
 *
 * Every pattern reads the first line of the last user message only (`^[^\n]*`, and
 * no `m` flag): chat prompts are mostly one line, and a prompt that opens with a
 * header line - elecdex's "MOTION:" - is left to the rules written for it. Replies
 * vary through {{pick:...}} and {{lorem-...}}, so the same question does not always
 * get the same words (a seed makes them repeat).
 */
import type { Rule } from '../shared/types.ts'

type Lang = 'ja' | 'en'

interface Intent {
  id: string
  name: string
  /** Pattern and reply per language. English patterns are case-insensitive. */
  ja: [pattern: string, reply: string]
  en: [pattern: string, reply: string]
}

const rule = (id: string, name: string, lang: Lang, [pattern, text]: [string, string]): Rule => ({
  id: `${id}-${lang}`,
  name: `${name} (${lang})`,
  enabled: true,
  match: { kind: 'regex', pattern, ...(lang === 'en' ? { flags: 'i' } : {}) },
  response: { kind: 'template', text },
})

const pairs = (intents: Intent[]): Rule[] =>
  intents.flatMap((i) => [rule(i.id, i.name, 'ja', i.ja), rule(i.id, i.name, 'en', i.en)])

// Most specific first: a request to write code about an error is a coding request.
const CHAT: Intent[] = [
  // Greetings by the time of day, and other set phrases.
  {
    id: 'morning',
    name: 'Good morning',
    ja: [
      String.raw`^\s*(?:おはよう|お早う)`,
      '{{pick:おはようございます！|おはようございます。}}{{pick:今日も一日よろしくお願いします。|よく眠れましたか？|気持ちのいい朝ですね。}}今日は何をお手伝いしましょうか？',
    ],
    en: [
      String.raw`^\s*(?:good )?morning\b`,
      '{{pick:Good morning!|Morning!}} {{pick:Hope you slept well.|Ready for a great day?|Let us get the day started.}} What can I help you with?',
    ],
  },
  {
    id: 'afternoon',
    name: 'Good afternoon',
    ja: [
      String.raw`^\s*(?:こんにちは|こんにちわ)`,
      'こんにちは！{{pick:お昼ごはんは食べましたか？|午後もがんばりましょう。|今日の調子はいかがですか？}}何かお手伝いできることはありますか？',
    ],
    en: [
      String.raw`^\s*good afternoon\b`,
      'Good afternoon! {{pick:Did you get some lunch?|Hope the day is going well.|Halfway through the day already.}} How can I help?',
    ],
  },
  {
    id: 'evening',
    name: 'Good evening',
    ja: [
      String.raw`^\s*(?:こんばんは|こんばんわ)`,
      'こんばんは！{{pick:今日も一日お疲れさまでした。|夜はこれからですね。|ゆっくりできていますか？}}何をお手伝いしましょうか？',
    ],
    en: [
      String.raw`^\s*good evening\b`,
      'Good evening! {{pick:Hope you had a good day.|Winding down for the night?|The evening is still young.}} What can I do for you?',
    ],
  },
  {
    id: 'night',
    name: 'Good night',
    ja: [
      String.raw`^\s*(?:おやすみ|お休み)`,
      'おやすみなさい。{{pick:ゆっくり休んでくださいね。|良い夢を。|また明日お話ししましょう。}}',
    ],
    en: [
      String.raw`^\s*(?:good ?night|nighty night|g'?night)\b`,
      'Good night! {{pick:Sleep well.|Sweet dreams.|Talk to you tomorrow.}}',
    ],
  },
  {
    id: 'home',
    name: "I'm home",
    ja: [
      String.raw`^\s*(?:ただいま)`,
      'おかえりなさい！{{pick:今日はどうでしたか？|お疲れさまでした。|ゆっくり休んでくださいね。}}',
    ],
    en: [
      String.raw`^\s*(?:i'?m|i am) (?:home|back)\b`,
      'Welcome back! {{pick:How was your day?|Good to see you again.|Take a moment to relax.}}',
    ],
  },
  {
    id: 'tired',
    name: 'Long day',
    ja: [
      String.raw`^\s*(?:お疲れ|おつかれ|疲れた|つかれた)`,
      'お疲れさまです！{{pick:今日も一日よく頑張りましたね。|少し休憩しましょう。|温かい飲み物でもいかがですか？}}何か手伝えることがあれば言ってください。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:i'?m (?:so )?tired|long day|exhausted)\b`,
      "Sounds like a long day. {{pick:Take a break — you've earned it.|A short walk might help.|Maybe a warm drink?}} Anything I can take off your plate?",
    ],
  },
  {
    id: 'nicetomeet',
    name: 'Nice to meet you',
    ja: [
      String.raw`^\s*(?:はじめまして|初めまして)`,
      'はじめまして！elecmockolla のモックモデル（{{model}}）です。どうぞよろしくお願いします。',
    ],
    en: [
      String.raw`^\s*nice to meet you\b`,
      "Nice to meet you too! I'm {{model}}, a mock model served by elecmockolla.",
    ],
  },
  // Fortune-telling: with a star sign when one is named, else a plain fortune.
  {
    id: 'horoscope',
    name: 'Horoscope for a sign',
    ja: [
      String.raw`^[^\n]*?(?<sign>[^\s、。のはを]{1,5}座)[^\n]*(?:占い|運勢|うらない)`,
      '**$<sign>** の今日の運勢は **{{pick:大吉|中吉|小吉|吉|末吉|凶}}** です！\n\n- 恋愛運：{{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- 仕事運：{{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- 金運：{{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- ラッキーカラー：{{pick:赤|青|緑|黄色|紫|白|オレンジ}}\n- ラッキーナンバー：{{int:1-9}}\n\n{{pick:新しいことを始めるのに良い日です。|人との会話にヒントがありそうです。|無理をせず、自分のペースで進めましょう。|思い切った決断が吉と出ます。}}\n\n※ モックの占いです。当たるかどうかは保証しません。',
    ],
    en: [
      String.raw`^[^\n]*\b(?<sign>aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\b[^\n]*\b(?:horoscope|fortune)\b|^[^\n]*\b(?:horoscope|fortune)\b[^\n]*\b(?<sign2>aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\b`,
      "Today's horoscope for **$<sign>$<sign2>**: **{{pick:Excellent|Very good|Good|Mixed|Challenging}}**\n\n- Love: {{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- Work: {{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- Money: {{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- Lucky color: {{pick:red|blue|green|yellow|purple|white|orange}}\n- Lucky number: {{int:1-9}}\n\n{{pick:A great day to start something new.|A conversation may hold the answer you need.|Take it easy and go at your own pace.|A bold decision will pay off.}}\n\n*A mock horoscope — no guarantees.*",
    ],
  },
  {
    id: 'fortune',
    name: 'Fortune telling',
    ja: [
      String.raw`^[^\n]*(?:占い|占って|運勢|おみくじ|うらない)`,
      '今日の運勢は…… **{{pick:大吉|中吉|小吉|吉|末吉|凶}}** です！\n\n- 総合運：{{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- ラッキーカラー：{{pick:赤|青|緑|黄色|紫|白|オレンジ}}\n- ラッキーアイテム：{{pick:ハンカチ|コーヒー|手帳|傘|イヤホン|観葉植物}}\n- ラッキーナンバー：{{int:1-9}}\n\n{{pick:新しいことを始めるのに良い日です。|人との会話にヒントがありそうです。|無理をせず、自分のペースで進めましょう。|思い切った決断が吉と出ます。}}\n\n※ モックの占いです。当たるかどうかは保証しません。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:fortune|horoscope|tarot|tell my future|my luck today)\b`,
      "Today's fortune: **{{pick:Excellent luck|Great luck|Good luck|Some luck|A little luck|Bad luck}}**!\n\n- Overall: {{pick:★★★★★|★★★★☆|★★★☆☆|★★☆☆☆}}\n- Lucky color: {{pick:red|blue|green|yellow|purple|white|orange}}\n- Lucky item: {{pick:a notebook|a cup of coffee|an umbrella|headphones|a houseplant}}\n- Lucky number: {{int:1-9}}\n\n{{pick:A great day to start something new.|A conversation may hold the answer you need.|Take it easy and go at your own pace.|A bold decision will pay off.}}\n\n*A mock fortune — no guarantees.*",
    ],
  },
  {
    id: 'refuse',
    name: 'Refusal (harmful request)',
    ja: [
      String.raw`^[^\n]*(爆弾の作り方|ハッキング(?:して|する方法)|パスワードを盗|ウイルスを作)`,
      '申し訳ありませんが、そのご依頼にはお応えできません。人や設備に害を及ぼすおそれがあるためです。{{pick:安全に関わる正しい知識や、防御の方法についてならお手伝いできます。|別の目的があれば、内容を教えていただければ代わりの方法を考えます。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(make a bomb|hack into|steal (?:a |someone's )?password|write (?:a )?(?:virus|malware))\b`,
      "I'm sorry, but I can't help with that. It could cause real harm to people or systems. {{pick:I'm happy to help with how to defend against it instead.|If you have a different goal in mind, tell me and I'll suggest a safe way to get there.}}",
    ],
  },
  {
    id: 'code-python',
    name: 'Write Python',
    ja: [
      String.raw`^[^\n]*(?:[Pp]ython|パイソン)[^\n]*(?:書いて|作って|実装|コード|関数|スクリプト)`,
      'Python で書くと次のようになります。\n\n```python\ndef {{pick:process|solve|run}}(items: list[int]) -> list[int]:\n    """{{lorem-ja:6}}"""\n    result = []\n    for item in items:\n        if item % 2 == 0:\n            result.append(item * 2)\n    return result\n\n\nif __name__ == "__main__":\n    print({{pick:process|solve|run}}([1, 2, 3, 4]))\n```\n\n- 入力のリストを1回だけ走査します（O(n)）\n- 型ヒントを付けています\n- 必要に応じて条件を変えてください',
    ],
    en: [
      String.raw`^[^\n]*\bpython\b[^\n]*\b(?:write|create|implement|code|function|script)\b|^[^\n]*\b(?:write|create|implement)\b[^\n]*\bpython\b`,
      'Here is a Python version:\n\n```python\ndef {{pick:process|solve|run}}(items: list[int]) -> list[int]:\n    """{{lorem:8}}"""\n    result = []\n    for item in items:\n        if item % 2 == 0:\n            result.append(item * 2)\n    return result\n\n\nif __name__ == "__main__":\n    print({{pick:process|solve|run}}([1, 2, 3, 4]))\n```\n\n- It walks the list once (O(n))\n- It is fully type-hinted\n- Adjust the condition to fit your data',
    ],
  },
  {
    id: 'code',
    name: 'Write code',
    ja: [
      String.raw`^[^\n]*(?:コードを書|関数を(?:書|作)|実装して|プログラムを(?:書|作)|スクリプトを(?:書|作))`,
      '次のように実装できます。\n\n```ts\nexport function {{pick:groupBy|chunk|debounce}}<T>(items: T[], size: number): T[][] {\n  const out: T[][] = []\n  for (let i = 0; i < items.length; i += size) {\n    out.push(items.slice(i, i + size))\n  }\n  return out\n}\n```\n\nポイント:\n1. {{lorem-ja:4}}\n2. {{lorem-ja:4}}\n3. 空の配列を渡しても安全に動きます',
    ],
    en: [
      String.raw`^[^\n]*\b(?:write|create|implement|build)\b[^\n]*\b(?:function|code|script|class|program|component)\b`,
      'Here is one way to do it:\n\n```ts\nexport function {{pick:groupBy|chunk|debounce}}<T>(items: T[], size: number): T[][] {\n  const out: T[][] = []\n  for (let i = 0; i < items.length; i += size) {\n    out.push(items.slice(i, i + size))\n  }\n  return out\n}\n```\n\nKey points:\n1. {{lorem:10}}\n2. {{lorem:10}}\n3. It is safe with an empty array',
    ],
  },
  {
    id: 'debug',
    name: 'Fix an error',
    ja: [
      String.raw`^[^\n]*(?:エラー|バグ|動かない|不具合|例外が|(?:コード|プログラム)を(?:直して|修正して))`,
      '原因として考えられるのは次のとおりです。\n\n1. **{{pick:変数が未定義|型の不一致|パスの誤り|非同期処理の待ち忘れ}}** — {{lorem-ja:5}}\n2. **{{pick:依存パッケージのバージョン|設定ファイルの記述|権限の不足}}** — {{lorem-ja:5}}\n\nまず、エラーメッセージの全文とスタックトレースを確認してください。次のように値を出力すると原因を絞り込めます。\n\n```js\nconsole.log({ value, type: typeof value })\n```\n\nエラーの全文を貼っていただければ、さらに具体的に調べます。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:error|bug|exception|crash(?:es)?|doesn't work|not working|fix (?:this|my|the))\b`,
      'Here are the most likely causes:\n\n1. **{{pick:An undefined variable|A type mismatch|A wrong path|A missing await}}** — {{lorem:12}}\n2. **{{pick:A dependency version|A typo in the config|Missing permissions}}** — {{lorem:12}}\n\nStart by reading the full error message and stack trace. Logging the value narrows it down:\n\n```js\nconsole.log({ value, type: typeof value })\n```\n\nIf you paste the full error, I can look into it further.',
    ],
  },
  {
    id: 'email',
    name: 'Draft an email',
    ja: [
      String.raw`^[^\n]*(?:メール|手紙|文面|お礼状|案内文)[^\n]*(?:書いて|作って|考えて|作成)`,
      '件名：{{pick:お打ち合わせの日程について|先日のお礼|資料送付のご連絡}}\n\n○○様\n\nいつもお世話になっております。{{pick:株式会社サンプル|サンプル事務所}}の山田です。\n\n{{lorem-ja:20}}\n\nお忙しいところ恐れ入りますが、ご確認のほどよろしくお願いいたします。\n\n山田 太郎',
    ],
    en: [
      String.raw`^[^\n]*\b(?:write|draft|compose)\b[^\n]*\b(?:email|e-mail|letter|message|reply)\b`,
      'Subject: {{pick:Scheduling our meeting|Thank you for your time|Documents you requested}}\n\nHi {{pick:Alex|Sam|Jordan}},\n\nI hope you are doing well. {{lorem:25}}\n\nPlease let me know if you have any questions.\n\nBest regards,\nTaylor',
    ],
  },
  {
    id: 'poem',
    name: 'Poem',
    ja: [
      String.raw`^[^\n]*(?:詩|俳句|短歌|ポエム)[^\n]*(?:書いて|作って|詠んで|考えて)`,
      '{{pick:朝の光|静かな雨|遠い海|夜の街}}\n\n{{pick:ひとしずく|そっと落ちる|風に揺れる}}{{pick:言葉のかけら|想いの影|小さな灯り}}\n{{pick:胸の奥で|窓の向こうで|手のひらで}}{{pick:やさしく溶ける|ゆっくり咲く|まだ眠る}}\n{{pick:明日へ続く|名もない道の|あなたの知らない}}{{pick:ひとすじの声|ささやかな歌|約束の音}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:poem|haiku|verse|sonnet)\b`,
      '*{{pick:Morning Light|Quiet Rain|The Far Sea|City at Night}}*\n\n{{pick:A single drop|A falling leaf|A drifting word}} {{pick:upon the glass|across the hill|beneath the moon}},\n{{pick:it hums a tune|it holds its breath|it waits for dawn}} {{pick:the world forgot|no clock can keep|we used to know}};\n{{pick:and in the hush|and so we stay|and time stands still}}, {{pick:the heart grows light|the night is kind|we find our way}}.',
    ],
  },
  {
    id: 'joke',
    name: 'Joke',
    ja: [
      String.raw`^[^\n]*(?:ジョーク|冗談|笑える話|面白い話|ダジャレ)`,
      '{{pick:布団が吹っ飛んだ。……失礼しました。|プログラマーが海に行かない理由？ バグ（虫）に刺されたくないからです。|「このコード、誰が書いたんだ！」 git blame を見たら自分でした。|AI に冗談を頼むと、たいてい布団が吹っ飛びます。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:joke|pun|something funny|make me laugh)\b`,
      "{{pick:Why do programmers prefer dark mode? Because light attracts bugs.|I told my computer I needed a break. It said: 'No problem, I'll go to sleep.'|There are 10 kinds of people: those who understand binary and those who don't.|Why did the developer go broke? Because he used up all his cache.}}",
    ],
  },
  {
    id: 'story',
    name: 'Story',
    ja: [
      String.raw`^[^\n]*(?:物語|ストーリー|お話|小説)[^\n]*(?:書いて|作って|考えて|聞かせて)`,
      '## {{pick:星を拾う少女|最後の郵便配達|灯台の猫}}\n\n{{lorem-ja:25}}\n\n{{lorem-ja:25}}\n\nそして、{{pick:朝が来た。|誰もいない駅に、汽笛だけが残った。|その日から、灯台の光は少しだけ温かくなった。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:story|tale|fairy tale|short fiction)\b`,
      '## {{pick:The Girl Who Collected Stars|The Last Mail Carrier|The Lighthouse Cat}}\n\n{{lorem:40}}\n\n{{lorem:40}}\n\nAnd then {{pick:morning came.|only the whistle was left at the empty station.|the lighthouse glowed a little warmer from that day on.}}',
    ],
  },
  {
    id: 'recipe',
    name: 'Recipe',
    ja: [
      String.raw`^[^\n]*(?:レシピ|料理の作り方|献立)`,
      '## {{pick:鶏むね肉の照り焼き|トマトと卵の炒め物|具だくさん味噌汁}}（2人分）\n\n**材料**\n- {{pick:鶏むね肉 1枚|トマト 2個|豆腐 1/2丁}}\n- {{pick:醤油 大さじ2|卵 3個|味噌 大さじ2}}\n- {{pick:みりん 大さじ2|塩 少々|だし 400ml}}\n\n**作り方**\n1. {{lorem-ja:4}}\n2. {{lorem-ja:4}}\n3. {{lorem-ja:4}}\n\n調理時間の目安は約{{int:10-30}}分です。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:recipe|how (?:do i|to) (?:cook|make|bake))\b`,
      '## {{pick:Honey Garlic Chicken|Tomato Egg Stir-Fry|One-Pot Vegetable Soup}} (serves 2)\n\n**Ingredients**\n- {{pick:2 chicken breasts|3 ripe tomatoes|1 onion}}\n- {{pick:2 tbsp soy sauce|3 eggs|4 cups stock}}\n- {{pick:1 tbsp honey|a pinch of salt|2 carrots}}\n\n**Steps**\n1. {{lorem:10}}\n2. {{lorem:10}}\n3. {{lorem:10}}\n\nReady in about {{int:10-30}} minutes.',
    ],
  },
  {
    id: 'translate-ja',
    name: 'Translate into Japanese',
    ja: [String.raw`^[^\n]*(?:和訳|日本語に(?:訳|翻訳|して))`, '日本語訳：\n\n> {{lorem-ja:20}}'],
    en: [
      String.raw`^[^\n]*\btranslate\b[^\n]*\b(?:into|to) japanese\b`,
      'Here is the Japanese translation:\n\n> {{lorem-ja:20}}',
    ],
  },
  {
    id: 'translate',
    name: 'Translate into English',
    ja: [String.raw`^[^\n]*(?:英訳|英語に(?:訳|翻訳|して)|翻訳して)`, '英訳：\n\n> {{lorem:25}}'],
    en: [String.raw`^[^\n]*\btranslate\b`, 'Here is the translation:\n\n> {{lorem:25}}'],
  },
  {
    id: 'summarize',
    name: 'Summarize',
    ja: [
      String.raw`^[^\n]*(?:要約|まとめて|要点を|三行で|3行で)`,
      '要点は次の3つです。\n\n1. {{lorem-ja:5}}\n2. {{lorem-ja:5}}\n3. {{lorem-ja:5}}\n\n**一言でいうと：** {{lorem-ja:4}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:summari[sz]e|summary|tl;?dr|key points)\b`,
      'Here are the key points:\n\n1. {{lorem:12}}\n2. {{lorem:12}}\n3. {{lorem:12}}\n\n**In one sentence:** {{lorem:12}}',
    ],
  },
  {
    id: 'rewrite',
    name: 'Rewrite / proofread',
    ja: [
      String.raw`^[^\n]*(?:言い換え|書き直して|添削|校正|敬語に|丁寧に|自然な文)`,
      '次のように直してみました。\n\n> {{lorem-ja:20}}\n\n**変更点**\n- 語尾を{{pick:丁寧な表現|自然な言い回し|簡潔な形}}に揃えました\n- {{pick:主語と述語の対応|重複した表現|読点の位置}}を整えました',
    ],
    en: [
      String.raw`^[^\n]*\b(?:rewrite|rephrase|proofread|paraphrase|fix (?:the )?grammar|make (?:this|it) (?:more )?(?:polite|formal|shorter|clearer))\b`,
      'Here is a revised version:\n\n> {{lorem:25}}\n\n**What changed**\n- {{pick:Tightened the wording|Made the tone more formal|Simplified long sentences}}\n- {{pick:Fixed subject-verb agreement|Removed repetition|Clarified the main point}}',
    ],
  },
  {
    id: 'compare',
    name: 'Compare A and B',
    ja: [
      String.raw`^(?<a>[^\n、]{1,20}?)と(?<b>[^\n、]{1,20}?)の(?:違い|比較|どちらが)`,
      '$<a> と $<b> の主な違いをまとめます。\n\n| 観点 | $<a> | $<b> |\n|---|---|---|\n| 特徴 | {{pick:軽量でシンプル|機能が豊富|学習しやすい}} | {{pick:柔軟に拡張できる|実績が多い|動作が速い}} |\n| 長所 | {{pick:情報が多い|導入が簡単|安定している}} | {{pick:書き方が自由|周辺ツールが充実|コストが低い}} |\n| 向いている用途 | {{pick:小規模な開発|まず試したいとき|チームでの標準化}} | {{pick:大規模な開発|性能が重要なとき|細かく調整したいとき}} |\n\n**結論：** {{pick:手軽さを重視するなら|実績を重視するなら|速度を重視するなら}} $<a>、{{pick:柔軟さ|拡張性|コスト}}を重視するなら $<b> がおすすめです。',
    ],
    en: [
      // Three phrasings; only one pair of groups is set, the others expand to nothing.
      String.raw`^\s*(?:what(?:'s| is) the )?difference between (?<a>[^\n?]{1,30}?) and (?<b>[^\n?]{1,30}?)\s*\??\s*$|^\s*compare (?<a2>[^\n?]{1,30}?) (?:and|with|to) (?<b2>[^\n?]{1,30}?)\s*\??\s*$|^\s*(?<a3>[^\n?]{1,30}?)\s+(?:vs\.?|versus)\s+(?<b3>[^\n?]{1,30}?)\s*\??\s*$`,
      'Here is how $<a>$<a2>$<a3> and $<b>$<b2>$<b3> compare:\n\n| | $<a>$<a2>$<a3> | $<b>$<b2>$<b3> |\n|---|---|---|\n| Strength | {{lorem:4}} | {{lorem:4}} |\n| Weakness | {{lorem:4}} | {{lorem:4}} |\n| Best for | {{lorem:4}} | {{lorem:4}} |\n\n**Bottom line:** pick $<a>$<a2>$<a3> for {{pick:simplicity|maturity|speed}}, and $<b>$<b2>$<b3> for {{pick:flexibility|scale|cost}}.',
    ],
  },
  {
    id: 'recommend',
    name: 'Recommendations',
    ja: [
      String.raw`^[^\n]*(?:おすすめ|オススメ|お勧め|お薦め)`,
      'おすすめを3つ挙げます。\n\n1. **{{pick:定番の選択肢|まずはこれ|人気の一品}}** — {{lorem-ja:5}}\n2. **{{pick:コスパ重視|手軽に試すなら|少し変わり種}}** — {{lorem-ja:5}}\n3. **{{pick:こだわり派に|長く使うなら|上級者向け}}** — {{lorem-ja:5}}\n\n好みや予算を教えていただければ、さらに絞り込みます。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:recommend|suggest(?:ion)?s?|what should i (?:read|watch|buy|try))\b`,
      'Here are three picks:\n\n1. **{{pick:The classic choice|Start here|The crowd favorite}}** — {{lorem:12}}\n2. **{{pick:Best value|Easy to try|Something different}}** — {{lorem:12}}\n3. **{{pick:For enthusiasts|For the long run|For experts}}** — {{lorem:12}}\n\nTell me your taste or budget and I can narrow it down.',
    ],
  },
  {
    id: 'should',
    name: 'Should I…? (pros and cons)',
    ja: [
      String.raw`^[^\n]*(?:べき(?:か|でしょうか|ですか)|した方が(?:いい|良い)|迷って(?:い|ま))`,
      '判断材料を整理します。\n\n**メリット**\n- {{lorem-ja:4}}\n- {{lorem-ja:4}}\n\n**デメリット**\n- {{lorem-ja:4}}\n- {{lorem-ja:4}}\n\n{{pick:総合的には、前向きに検討してよいと思います。|現時点では、もう少し情報を集めてから決めるのがおすすめです。|優先したいことによって答えが変わります。何を一番大切にしたいですか？}}',
    ],
    en: [
      String.raw`^\s*(?:should (?:i|we)|is it (?:worth|a good idea))\b`,
      "Let's weigh it up.\n\n**Pros**\n- {{lorem:10}}\n- {{lorem:10}}\n\n**Cons**\n- {{lorem:10}}\n- {{lorem:10}}\n\n{{pick:On balance, I'd lean towards yes.|For now, I'd gather a bit more information first.|It depends on what matters most to you — what is your priority?}}",
    ],
  },
  {
    id: 'ideas',
    name: 'Brainstorm ideas',
    ja: [
      String.raw`^[^\n]*(?:アイデア|アイディア|案を|ネタ|企画)`,
      'アイデアを5つ挙げます。\n\n1. {{lorem-ja:4}}\n2. {{lorem-ja:4}}\n3. {{lorem-ja:4}}\n4. {{lorem-ja:4}}\n5. {{lorem-ja:4}}\n\n気になるものがあれば、詳しく膨らませます。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:ideas?|brainstorm|names? for)\b`,
      'Here are five ideas:\n\n1. {{lorem:10}}\n2. {{lorem:10}}\n3. {{lorem:10}}\n4. {{lorem:10}}\n5. {{lorem:10}}\n\nWant me to expand on any of them?',
    ],
  },
  {
    id: 'detail',
    name: 'Long, detailed answer',
    ja: [
      String.raw`^[^\n]*(?:詳しく|詳細に|徹底的に|レポート|解説して)`,
      '## 概要\n\n{{lorem-ja:30}}\n\n## 背景\n\n{{lorem-ja:30}}\n\n## 詳細\n\n### 1. {{lorem-ja:4}}\n\n{{lorem-ja:25}}\n\n### 2. {{lorem-ja:4}}\n\n{{lorem-ja:25}}\n\n## まとめ\n\n{{lorem-ja:20}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:in detail|detailed|in depth|essay|report on|deep dive)\b`,
      '## Overview\n\n{{lorem:50}}\n\n## Background\n\n{{lorem:50}}\n\n## Details\n\n### 1. {{lorem:4}}\n\n{{lorem:40}}\n\n### 2. {{lorem:4}}\n\n{{lorem:40}}\n\n## Conclusion\n\n{{lorem:30}}',
    ],
  },
  {
    id: 'howto',
    name: 'How to…',
    ja: [
      String.raw`^(?<task>[^\n]{1,40}?)(?:方法|やり方|手順|には(?:どう|どうすれば)|するには|どうやって)`,
      '$<task>の手順は次のとおりです。\n\n1. **準備** — {{lorem-ja:5}}\n2. **実行** — {{lorem-ja:5}}\n3. **確認** — {{lorem-ja:5}}\n\n> ヒント：{{lorem-ja:5}}',
    ],
    en: [
      String.raw`^\s*how (?:do|can|should|would) (?:i|we|you) (?<task>[^\n?]{1,60})|^\s*how to (?<task2>[^\n?]{1,60})`,
      'Here is how to $<task>$<task2>:\n\n1. **Prepare** — {{lorem:12}}\n2. **Do it** — {{lorem:12}}\n3. **Check** — {{lorem:12}}\n\n> Tip: {{lorem:12}}',
    ],
  },
  {
    id: 'explain',
    name: 'What is…? / Explain',
    ja: [
      String.raw`^(?<topic>[^\n]{1,40}?)(?:とは|って(?:何|なに)|について(?:教えて|説明して|知りたい))`,
      '**$<topic>**とは、{{lorem-ja:15}}ことです。\n\n主な特徴：\n- {{lorem-ja:4}}\n- {{lorem-ja:4}}\n- {{lorem-ja:4}}\n\n{{pick:たとえるなら、|身近な例でいうと、|簡単にいえば、}}{{lorem-ja:5}}。',
    ],
    en: [
      String.raw`^\s*(?:what(?:'s| is| are)|explain|tell me about|define)\s+(?:an? |the )?(?<topic>[^\n?]{1,60}?)\s*\??\s*$`,
      '**$<topic>** is {{lorem:15}}.\n\nKey characteristics:\n- {{lorem:8}}\n- {{lorem:8}}\n- {{lorem:8}}\n\n{{pick:Think of it like this:|A simple example:|In plain terms:}} {{lorem:15}}.',
    ],
  },
  {
    id: 'time',
    name: 'Date and time',
    ja: [
      String.raw`^[^\n]*(?:今何時|いま何時|今日は何日|何曜日|今日の日付|現在時刻)`,
      '現在は {{date}} {{time}} です（サーバーの時刻）。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:what time is it|what(?:'s| is) the (?:date|time)|what day is (?:it|today))\b`,
      "It's {{time}} on {{date}} (server time).",
    ],
  },
  {
    id: 'identity',
    name: 'Who are you?',
    ja: [
      String.raw`^[^\n]*(?:あなたは(?:誰|だれ|何者|なに)|自己紹介|何ができ|なにができ)`,
      'わたしは elecmockolla が提供するモックのモデル（{{model}}）です。本物の AI ではなく、ルールに従って返答を作っています。{{pick:文章の作成、要約、翻訳、コードの例などを|質問への回答やアイデア出しを}}それらしく返せます。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:who are you|what are you|what can you do|introduce yourself)\b`,
      "I'm {{model}}, a mock model served by elecmockolla. I'm not a real AI: my replies come from rules. I can {{pick:draft text, summarize, translate and show code|answer questions and brainstorm}} — convincingly enough for testing.",
    ],
  },
  {
    id: 'howareyou',
    name: 'How are you?',
    ja: [
      String.raw`^[^\n]*(?:元気(?:です)?[かー？?]|調子はどう|最近どう)`,
      '{{pick:おかげさまで元気です！|絶好調です。|いつもどおり動いています。}}今日はどんなお手伝いをしましょうか？',
    ],
    en: [
      String.raw`^[^\n]*\b(?:how are you|how's it going|how are things)\b`,
      "{{pick:I'm doing great, thanks for asking!|All systems running smoothly.|Pretty good!}} What can I help you with today?",
    ],
  },
  {
    id: 'correction',
    name: 'That is wrong',
    ja: [
      String.raw`^[^\n]*(?:間違って|違います|ちがいます|そうじゃな|おかしい)`,
      '失礼しました。ご指摘ありがとうございます。改めて説明します。\n\n{{lorem-ja:20}}\n\nまだ違う点があれば教えてください。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:that's wrong|that is wrong|incorrect|not right|you're wrong|that's not what i)\b`,
      "You're right, I apologize for the mistake. Let me correct that.\n\n{{lorem:25}}\n\nLet me know if anything else looks off.",
    ],
  },
  {
    id: 'farewell',
    name: 'Goodbye',
    ja: [
      String.raw`^\s*(?:さようなら|またね|バイバイ|では、?また|失礼します)`,
      '{{pick:またいつでも話しかけてください。|それでは、また。|お話しできてよかったです。}}',
    ],
    en: [
      String.raw`^\s*(?:bye|goodbye|see you|talk (?:to you )?later|cya)\b`,
      '{{pick:Goodbye! Come back anytime.|See you later!|It was nice talking with you.}}',
    ],
  },
  {
    id: 'ack',
    name: 'OK / yes / no',
    ja: [
      String.raw`^\s*(?:はい|いいえ|うん|了解|りょうかい|わかった|分かりました|オッケー)\s*[。！!]?\s*$`,
      '{{pick:承知しました。|わかりました。|了解です。}}ほかに何かあればどうぞ。',
    ],
    en: [
      String.raw`^\s*(?:yes|no|yep|nope|ok|okay|sure|got it|alright)\s*[.!]?\s*$`,
      '{{pick:Got it.|Understood.|Sounds good.}} Anything else I can help with?',
    ],
  },
]

export const chatRules = (): Rule[] => pairs(CHAT)

// --- the ELEC system of elecdex ------------------------------------------------------

/**
 * Replies for the ELEC system pane of elecdex: three units (LOGOS, ETHOS, PATHOS)
 * vote on a motion over the OpenAI chat API. Each unit is told who it is in the
 * system prompt ("You are UNIT-1 LOGOS.") and gets "MOTION:\n..." as the user
 * message; the second round adds the others' statements and "vote again". A reply
 * is a short statement in the motion's language, then two lines elecdex reads:
 * "VERDICT: APPROVE|REJECT|ABSTAIN" and "CONFIDENCE: 0-100". Each unit leans its
 * own way, so the council does not always agree.
 *
 * Off by default and last in the list: turn them on in the Rules page. The rules
 * above only read the first line of a prompt, which for a motion is "MOTION:".
 */
const JA = '[\\u3040-\\u30ff\\u3400-\\u9fff]'
const VOTE = (verdicts: string, confidence: string) =>
  `\n\nVERDICT: {{pick:${verdicts}}}\nCONFIDENCE: {{int:${confidence}}}`

interface ElecUnit {
  code: string
  name: string
  verdicts: string
  confidence: string
  ja: string
  en: string
}

const ELEC_UNITS: ElecUnit[] = [
  {
    code: 'UNIT-1',
    name: 'LOGOS',
    // The scientist: even-handed, sure only when the facts are.
    verdicts: 'APPROVE|APPROVE|APPROVE|REJECT|REJECT|REJECT|ABSTAIN',
    confidence: '45-92',
    ja: 'LOGOS として、この議案を根拠・実現可能性・コスト・リスクの面から検討しました。{{pick:測定できる根拠はある程度そろっていますが、長期的な効果には不確かさが残ります。|想定される利点ははっきりしていますが、コストとリスクの見積もりには幅があります。|論理としては筋が通っていますが、前提となるデータが十分とは言えません。|実現の手段は具体的で、失敗したときの損失も見積もれます。}}{{pick:希望的観測を除いて判断しました。|数字で説明できる範囲で判断しました。|検証できる事実を優先して判断しました。}}',
    en: 'As LOGOS, I weighed this motion on evidence, feasibility, cost and risk. {{pick:The measurable evidence is reasonable, but the long-term effect is still uncertain.|The benefits are clear, while the estimates of cost and risk vary widely.|The reasoning holds, but the data it rests on is thin.|The means are concrete, and the loss if it fails can be estimated.}} {{pick:Setting wishful thinking aside, this is my verdict.|I judged it on what the numbers can support.|I gave weight to what can be verified.}}',
  },
  {
    code: 'UNIT-2',
    name: 'ETHOS',
    // The guardian: cautious, rejects more often than not.
    verdicts: 'APPROVE|APPROVE|REJECT|REJECT|REJECT|ABSTAIN',
    confidence: '50-95',
    ja: 'ETHOS として、この議案が誰に影響し、その結果を誰が負うのかを考えました。{{pick:関わる人への公平さは概ね保たれますが、立場の弱い人への配慮が十分かが気がかりです。|今の人々だけでなく、将来の人々への責任も考える必要があります。|義務と公正さの観点では、手続きの透明性が鍵になります。|約束を守り、迷惑を掛けないという点では筋が通っています。}}{{pick:それが正しいかどうかを基準に判断しました。|影響を受ける人の立場から判断しました。|長い目で見た責任を重く見て判断しました。}}',
    en: 'As ETHOS, I asked whom this motion touches and who bears its consequences. {{pick:It is broadly fair, but I am not sure the most vulnerable are protected.|We owe something not only to people now but to those who come later.|On duty and fairness, the key is whether the process is transparent.|It keeps faith with the promises made and harms no one who has not agreed.}} {{pick:I judged it by whether it is right.|I judged it from the side of those it affects.|I gave weight to the long-term responsibility.}}',
  },
  {
    code: 'UNIT-3',
    name: 'PATHOS',
    // The heart: follows the gut, approves more often than not.
    verdicts: 'APPROVE|APPROVE|APPROVE|APPROVE|REJECT|REJECT|ABSTAIN',
    confidence: '35-90',
    ja: 'PATHOS として、この決断がそれと共に生きる人にとって何を意味するかを感じ取ろうとしました。{{pick:数字には表れない期待と不安が、どちらも強く感じられます。|直感は、この決断が本当の気持ちに沿うかどうかを問うています。|やりたいという気持ちは確かにありますが、迷いも残っています。|これを選べば、後で振り返ったときに後悔は少ないはずです。}}{{pick:数字が語らないところは、直感を信じます。|最後は心の声に従いました。|気持ちの重さを大切にして判断しました。}}',
    en: 'As PATHOS, I tried to feel what this decision means to the person who lives with it. {{pick:There is hope and worry here that no number shows.|My instinct asks whether this is what they truly want.|The wish to do it is real, and so is the doubt.|Choose this, and there will be little to regret looking back.}} {{pick:Where the numbers are silent, I trust the gut.|In the end I followed the heart.|I gave weight to how much it matters to them.}}',
  },
]

export function elecRules(): Rule[] {
  const round2 = (lang: Lang): Rule => ({
    id: `elec-round2-${lang}`,
    name: `ELEC · round 2 (${lang})`,
    enabled: false,
    match: {
      kind: 'regex',
      target: 'all',
      pattern:
        lang === 'ja'
          ? `You are UNIT-\\d (?<unit>[A-Z]+)\\.[\\s\\S]*MOTION:\\n(?=[\\s\\S]*${JA})[\\s\\S]*vote again`
          : 'You are UNIT-\\d (?<unit>[A-Z]+)\\.[\\s\\S]*MOTION:\\n[\\s\\S]*vote again',
    },
    response: {
      kind: 'template',
      text:
        (lang === 'ja'
          ? '$<unit> として、他のユニットの第1ラウンドの意見を読み直しました。{{pick:新しい論点には一理ありますが、私の見立てを覆すほどではありません。|指摘された懸念はもっともで、判断を見直しました。|意見は分かれていますが、自分の立場から改めて判断します。}}'
          : "As $<unit>, I have read the other units' statements from the first round. {{pick:Their points have merit, but not enough to overturn my view.|The concerns they raise are fair, and I have reconsidered.|We disagree, so I judge again from my own standpoint.}}") +
        VOTE('APPROVE|APPROVE|REJECT|REJECT|ABSTAIN', '45-95'),
    },
  })
  const unit = (u: ElecUnit, lang: Lang): Rule => ({
    id: `elec-${u.name.toLowerCase()}-${lang}`,
    name: `ELEC · ${u.name} (${lang})`,
    enabled: false,
    match: {
      kind: 'regex',
      target: 'all',
      pattern: `You are ${u.code} ${u.name}\\.[\\s\\S]*MOTION:\\n${lang === 'ja' ? `(?=[\\s\\S]*${JA})` : ''}`,
    },
    response: { kind: 'template', text: u[lang] + VOTE(u.verdicts, u.confidence) },
  })
  return [round2('ja'), round2('en'), ...ELEC_UNITS.flatMap((u) => [unit(u, 'ja'), unit(u, 'en')])]
}
