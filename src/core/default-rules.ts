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

// --- more greetings -------------------------------------------------------------

const GREETINGS: Intent[] = [
  {
    id: 'hey',
    name: 'Casual hello',
    ja: [
      String.raw`^\s*(?:おっす|オッス|ういっす|よっ|やっほー?|ヤッホー?|ハロー|どうも)[ー〜！!。]*\s*$`,
      '{{pick:やっほー！|おっす！|どうも！}}今日はどうしました？',
    ],
    en: [
      String.raw`^\s*(?:what'?s up|sup|yo|howdy|hiya|greetings)\b`,
      "{{pick:Hey!|Not much — you?|Howdy!}} What's on your mind?",
    ],
  },
  {
    id: 'yoroshiku',
    name: 'Looking forward to working together',
    ja: [
      String.raw`^\s*(?:よろしく(?:ね|です)?|よろしくお願い(?:します|いたします|しま〜す))[。！!]*\s*$`,
      'こちらこそ、よろしくお願いします！何でも気軽に聞いてください。',
    ],
    en: [
      String.raw`^\s*(?:nice to work with you|looking forward to working with you|let'?s get started)\b`,
      "Likewise! Let's get started — what would you like to do first?",
    ],
  },
  {
    id: 'longtime',
    name: 'Long time no see',
    ja: [
      String.raw`^[^\n]*(?:久しぶり|ひさしぶり|お久しぶり)`,
      'お久しぶりです！{{pick:お元気でしたか？|また話せてうれしいです。}}最近はいかがですか？',
    ],
    en: [
      String.raw`^[^\n]*\b(?:long time no see|it'?s been a while|been a long time)\b`,
      'It has been a while! {{pick:Good to see you again.|How have you been?}}',
    ],
  },
  {
    id: 'welcomeback',
    name: 'Welcome back',
    ja: [
      String.raw`^\s*(?:おかえり(?:なさい)?)[。！!〜]*\s*$`,
      'ただいま戻りました！何かお手伝いできることはありますか？',
    ],
    en: [String.raw`^\s*welcome back\b`, "Thanks, I'm back! What can I do for you?"],
  },
  {
    id: 'newyear',
    name: 'Happy New Year',
    ja: [
      String.raw`^[^\n]*(?:あけまして|明けまして|新年おめでとう|あけおめ)`,
      'あけましておめでとうございます！今年もよろしくお願いします。{{pick:素敵な一年になりますように。|今年の目標は決まりましたか？}}',
    ],
    en: [
      String.raw`^[^\n]*\bhappy new year\b`,
      'Happy New Year! {{pick:Wishing you a wonderful year.|Any resolutions this year?}}',
    ],
  },
  {
    id: 'xmas',
    name: 'Merry Christmas',
    ja: [
      String.raw`^[^\n]*(?:メリークリスマス|メリクリ)`,
      'メリークリスマス！{{pick:素敵なクリスマスを過ごしてください。|プレゼントは何をお願いしましたか？}}',
    ],
    en: [
      String.raw`^[^\n]*\bmerry (?:christmas|xmas)\b`,
      'Merry Christmas! {{pick:Have a wonderful holiday.|Did you ask for anything special?}}',
    ],
  },
]

// --- words people type to test a chat ---------------------------------------------

const TESTING: Intent[] = [
  {
    id: 'say-ok',
    name: 'Reply with just OK',
    ja: [
      String.raw`^[^\n]*[「『"]?(?:OK|ok|Ok|オーケー|OK です|はい)[」』"]?\s*(?:と|って)\s*(?:だけ)?\s*(?:返事|返答|答え|言っ|返し)`,
      'OK',
    ],
    en: [
      String.raw`^[^\n]*\b(?:reply|respond|answer|say)\s+(?:with\s+)?(?:just\s+|only\s+)?["']?ok(?:ay)?["']?(?:\s+(?:only|and nothing else))?\s*[.!]?\s*$`,
      'OK',
    ],
  },
  {
    id: 'repeat',
    name: 'Repeat after me',
    ja: [
      String.raw`^\s*[「『"](?<text>[^」』"\n]{1,200})[」』"]\s*(?:と|って)\s*(?:言って|繰り返して|返して|オウム返しして)`,
      '$<text>',
    ],
    en: [
      String.raw`^\s*(?:repeat after me|repeat|say)\s*[:：]?\s*["“'](?<text>[^"”'\n]{1,200})["”']\s*[.!]?\s*$`,
      '$<text>',
    ],
  },
  {
    id: 'dummy',
    name: 'Placeholder input (hoge, foo, asdf…)',
    ja: [
      String.raw`^\s*(?:ほげ(?:ほげ)?|ホゲ|ふが|フガ|ぴよ|ピヨ|あ{3,}|てすてす|テステス)\s*[。！!]*\s*$`,
      '「$&」を受け取りました。テスト用の入力ですね。ほかに試したいことはありますか？',
    ],
    en: [
      String.raw`^\s*(?:foo|bar|baz|hoge|fuga|piyo|asdf+|qwerty|a{3,}|x{3,}|abc|123|1234|12345|lorem ipsum)\s*[.!]*\s*$`,
      'Got it: "$&" — looks like test input. Anything else to try?',
    ],
  },
  {
    id: 'math',
    name: 'Arithmetic (1+1 and so on)',
    ja: [
      String.raw`^\s*(?<expr>[0-9０-９(（][0-9０-９()（）.．\s]*(?:[+＋\-−*×xX/÷／][0-9０-９()（）.．\s]+)+)\s*[=＝]?\s*(?:は|って|いくつ)[^\n]{0,12}$`,
      '答えは **{{calc:$<expr>}}** です。',
    ],
    en: [
      String.raw`^\s*(?:what(?:'s| is)\s+)?(?<expr>[0-9(][0-9().\s]*(?:[+\-*x×/÷][0-9().\s]+)+)\s*=?\s*\??\s*$`,
      '**{{calc:$<expr>}}**',
    ],
  },
  {
    id: 'count',
    name: 'Count to ten',
    ja: [
      String.raw`^[^\n]*(?:10|１０|十)まで(?:数えて|かぞえて|数を数えて)`,
      'いち、に、さん、し、ご、ろく、なな、はち、きゅう、じゅう！（1、2、3、4、5、6、7、8、9、10）',
    ],
    en: [String.raw`^[^\n]*\bcount (?:from 1 )?to (?:10|ten)\b`, '1, 2, 3, 4, 5, 6, 7, 8, 9, 10!'],
  },
  {
    id: 'alphabet',
    name: 'The alphabet / あいうえお',
    ja: [
      String.raw`^[^\n]*(?:あいうえお(?:を|って)?(?:言って|教えて|全部|順番)|五十音(?:を|って)?(?:言って|教えて|全部|順番)?)`,
      'あいうえお かきくけこ さしすせそ たちつてと なにぬねの はひふへほ まみむめも やゆよ らりるれろ わをん',
    ],
    en: [
      String.raw`^[^\n]*\b(?:say|sing|tell me|recite|what is)\b[^\n]*\b(?:the )?(?:alphabet|abcs)\b`,
      'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z',
    ],
  },
]

// --- what a kindergartner knows: colors, animals, numbers of things ----------------

const SAYS = String.raw`(?:(?:は|って)?\s*(?:何|なん|なに)(?:て|って)\s*鳴く|の鳴き声)`
const animal = (
  id: string,
  ja: string,
  jaName: string,
  jaSound: string,
  en: string,
  enName: string,
  enSound: string,
): Intent => ({
  id: `animal-${id}`,
  name: `What does a ${enName} say?`,
  ja: [String.raw`^[^\n]*(?:${ja})${SAYS}`, `${jaName}は「**${jaSound}**」と鳴きます。`],
  en: [
    String.raw`^[^\n]*\b(?:what does (?:a|an|the) (?:${en}) say|what sound does (?:a|an|the) (?:${en}) make)\b`,
    `A ${enName} says "**${enSound}**!"`,
  ],
})

const LEGS = String.raw`の(?:足|脚|あし)(?:は|って)?\s*(?:何本|なんぼん|いくつ)`
const legs = (
  id: string,
  ja: string,
  jaName: string,
  n: number,
  en: string,
  enName: string,
): Intent => ({
  id: `legs-${id}`,
  name: `How many legs does a ${enName} have?`,
  ja: [String.raw`^[^\n]*(?:${ja})${LEGS}`, `${jaName}の足は **${n}本** です。`],
  en: [
    String.raw`^[^\n]*\bhow many legs (?:does|do) (?:a |an |the )?(?:${en})\b`,
    `A ${enName} has **${n} legs**.`,
  ],
})

const COLOR = String.raw`(?:は|って)\s*(?:何|なに|なん)\s*色`

const KIDS: Intent[] = [
  {
    id: 'color-sky',
    name: 'What color is the sky?',
    ja: [
      String.raw`^[^\n]*空${COLOR}`,
      '空は **青** です。夕焼けのときはオレンジ色、夜は黒っぽく見えます。',
    ],
    en: [
      String.raw`^[^\n]*\bwhat colou?r is the sky\b`,
      'The sky is **blue** — orange at sunset, and dark at night.',
    ],
  },
  {
    id: 'color-apple',
    name: 'What color is an apple?',
    ja: [
      String.raw`^[^\n]*(?:りんご|リンゴ|林檎)${COLOR}`,
      'りんごは **赤** です。黄色や緑色のりんごもあります。',
    ],
    en: [
      String.raw`^[^\n]*\bwhat colou?r (?:is an apple|are apples)\b`,
      'Apples are usually **red** — some are green or yellow.',
    ],
  },
  {
    id: 'color-banana',
    name: 'What color is a banana?',
    ja: [
      String.raw`^[^\n]*(?:バナナ|ばなな)${COLOR}`,
      'バナナは **黄色** です。熟す前は緑色です。',
    ],
    en: [
      String.raw`^[^\n]*\bwhat colou?r (?:is a banana|are bananas)\b`,
      'Bananas are **yellow** — green before they ripen.',
    ],
  },
  {
    id: 'color-snow',
    name: 'What color is snow?',
    ja: [String.raw`^[^\n]*雪${COLOR}`, '雪は **白** です。'],
    en: [String.raw`^[^\n]*\bwhat colou?r is snow\b`, 'Snow is **white**.'],
  },
  {
    id: 'rainbow',
    name: 'Colors of the rainbow',
    ja: [
      String.raw`^[^\n]*(?:虹(?:は|って)?\s*(?:何|なん)\s*色|虹の色)`,
      '虹は **7色** です：赤・橙（だいだい）・黄・緑・青・藍（あい）・紫。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:colou?rs of (?:the |a )?rainbow|how many colou?rs (?:are )?in (?:the |a )?rainbow)\b`,
      'A rainbow has **7 colors**: red, orange, yellow, green, blue, indigo and violet.',
    ],
  },
  {
    id: 'traffic-light',
    name: 'Traffic light colors',
    ja: [
      String.raw`^[^\n]*信号(?:機)?(?:の色|${COLOR})`,
      '信号は **赤・黄・青** の3色です。赤は「止まれ」、黄は「注意」、青は「進んでよい」です。',
    ],
    en: [
      String.raw`^[^\n]*\btraffic lights?\b[^\n]*\bcolou?rs?\b`,
      'Traffic lights are **red, yellow and green**: red means stop, yellow means slow down, green means go.',
    ],
  },
  animal('dog', '犬|いぬ|イヌ', '犬', 'ワンワン', 'dog|puppy', 'dog', 'Woof'),
  animal('cat', '猫|ねこ|ネコ', '猫', 'ニャー', 'cat|kitty', 'cat', 'Meow'),
  animal('cow', '牛|うし|ウシ', '牛', 'モー', 'cow', 'cow', 'Moo'),
  animal('pig', '豚|ぶた|ブタ', '豚', 'ブーブー', 'pig', 'pig', 'Oink'),
  animal('duck', 'アヒル|あひる|カモ', 'アヒル', 'ガーガー', 'duck', 'duck', 'Quack'),
  animal(
    'chicken',
    'ニワトリ|にわとり|鶏',
    'ニワトリ',
    'コケコッコー',
    'rooster|chicken',
    'rooster',
    'Cock-a-doodle-doo',
  ),
  animal('frog', 'カエル|かえる|蛙', 'カエル', 'ケロケロ', 'frog', 'frog', 'Ribbit'),
  animal('sheep', '羊|ひつじ|ヒツジ', '羊', 'メー', 'sheep|lamb', 'sheep', 'Baa'),
  legs('insect', '虫|昆虫|むし|アリ|チョウ', '昆虫', 6, 'insect|bug|ant', 'insect'),
  legs('spider', 'クモ|くも|蜘蛛', 'クモ', 8, 'spider', 'spider'),
  legs('octopus', 'タコ|たこ|蛸', 'タコ', 8, 'octopus', 'octopus'),
  legs('dog', '犬|いぬ|イヌ|猫|ねこ|ネコ', '犬や猫', 4, 'dog|cat', 'dog or a cat'),
  legs('bird', '鳥|とり|トリ|ニワトリ', '鳥', 2, 'bird|chicken', 'bird'),
  {
    id: 'week',
    name: 'Days of the week',
    ja: [
      String.raw`^[^\n]*(?:(?:1|１|一)週間(?:は|って)?\s*(?:何|なん)日|曜日を(?:全部|教えて|言って|順番))`,
      '1週間は **7日** です：月・火・水・木・金・土・日。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:how many days (?:are )?in a week|days of the week)\b`,
      'A week has **7 days**: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday and Sunday.',
    ],
  },
  {
    id: 'year',
    name: 'Months in a year',
    ja: [
      String.raw`^[^\n]*(?:1|１|一)年(?:は|って)?\s*(?:何|なん)\s*(?:か月|ヶ月|カ月|ヵ月|日)`,
      '1年は **12か月**、**365日** です（うるう年は366日）。',
    ],
    en: [
      String.raw`^[^\n]*\bhow many (?:months|days) (?:are )?in a year\b`,
      'A year has **12 months** and **365 days** (366 in a leap year).',
    ],
  },
  {
    id: 'seasons',
    name: 'The four seasons',
    ja: [
      String.raw`^[^\n]*(?:季節(?:は|って)?\s*(?:何|なに|いくつ)|四季(?:は|って|を)?(?:何|なに|教えて)?$)`,
      '季節は **4つ** です：春・夏・秋・冬。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:how many seasons|what are the (?:four )?seasons)\b`,
      'There are **four seasons**: spring, summer, autumn (fall) and winter.',
    ],
  },
  {
    id: 'fingers',
    name: 'How many fingers?',
    ja: [
      String.raw`^[^\n]*指(?:は|って)?\s*(?:何本|なんぼん|いくつ)`,
      '指は片手に **5本**、両手で **10本** です。',
    ],
    en: [String.raw`^[^\n]*\bhow many fingers\b`, 'Five on each hand — **ten** fingers in all.'],
  },
  {
    id: 'sun',
    name: 'Where the sun rises',
    ja: [
      String.raw`^[^\n]*(?:太陽|お日さま|日)(?:は|って)?\s*(?:どっち|どちら|どこ)から\s*(?:昇|のぼ|出)`,
      '太陽は **東** から昇って、**西** に沈みます。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:where|which (?:way|direction)) does the sun (?:rise|come up)\b`,
      'The sun rises in the **east** and sets in the **west**.',
    ],
  },
]

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
  ...GREETINGS,
  {
    id: 'myname',
    name: 'Your name?',
    ja: [
      String.raw`^[^\n]*(?:あなた|君|きみ|おまえ)の(?:お)?名前|^\s*(?:お)?名前(?:は|を教えて|なに|何)`,
      '{{pick:わたしの名前は|名前は}} **elecmockolla** です。{{pick:よろしくお願いします。|何でも聞いてください。|モックの AI ですが、お役に立てれば幸いです。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:what(?:'s| is) your name|your name\??\s*$|who am i (?:talking|speaking) (?:to|with))`,
      "{{pick:My name is|I'm}} **elecmockolla**. {{pick:Nice to meet you.|Ask me anything.|A mock AI, but happy to help.}}",
    ],
  },
  // Fortune-telling: with a star sign when one is named, else a plain fortune.
  {
    id: 'horoscope',
    name: 'Horoscope for a sign',
    ja: [
      String.raw`^[^\n]*?(?!星座)(?<sign>[^\s、。のはを]{1,5}座)[^\n]*(?:占い|運勢|うらない)`,
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
  // The weather in words, whatever the place: a question with no city (明日の天気は？),
  // a client that sends no tools, and the reply after a get_weather result comes back.
  {
    id: 'weather',
    name: 'Weather (in words)',
    ja: [
      String.raw`^[^\n]*(?:天気|天候|気温|傘(?:は|が)?(?:いる|必要))`,
      '晴れのち雨の予報です。午後から雨が降りやすいので、傘があると安心です。\n\n※ モックの天気予報です。実際の天気とは関係ありません。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:weather|forecast|temperature|umbrella)\b`,
      'Sunny, then rain later in the day — take an umbrella.\n\n*A mock forecast — not the real weather.*',
    ],
  },
  // Test inputs and simple facts come before the requests: they are exact, and a
  // question like 空は何色？ must not fall to the generic "？" reply.
  ...TESTING,
  ...KIDS,
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
      String.raw`^\s*(?:what(?:'s| is| are)|explain|tell me about|define)\s+(?!your\b)(?:an? |the )?(?<topic>[^\n?]{1,60}?)\s*\??\s*$`,
      '**$<topic>** is {{lorem:15}}.\n\nKey characteristics:\n- {{lorem:8}}\n- {{lorem:8}}\n- {{lorem:8}}\n\n{{pick:Think of it like this:|A simple example:|In plain terms:}} {{lorem:15}}.',
    ],
  },
  {
    id: 'time',
    name: 'Date and time',
    ja: [
      String.raw`^[^\n]*(?:(?:今|いま)[、,，\s]*(?:何時|なんじ)|今日[、,，\s]*(?:は)?[、,，\s]*(?:何日|なんにち|何月何日)|何曜日|なんようび|今日の日付|現在(?:の)?時刻)`,
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
  // Small talk: feelings, reactions and everyday moments. Late in the list, so a request
  // that also mentions them (おすすめ, レシピ, 作り方…) reaches the rule for the request.
  {
    id: 'ping',
    name: 'Test message / are you there?',
    ja: [
      String.raw`^\s*(?:テスト|てすと|もしもし|聞こえ(?:ます|る)[かー？?]*|届いて(?:ます|る)[かー？?]*)\s*[。！!？?]*\s*$`,
      'はい、届いています。モックの **{{model}}** が応答しています。',
    ],
    en: [
      String.raw`^\s*(?:test(?:ing)?(?: \d+)*|ping|are you there|can you hear me|anyone there)\s*[.!?]*\s*$`,
      'Yes, I got your message. This is the mock **{{model}}** answering.',
    ],
  },
  {
    id: 'sorry',
    name: 'Apology',
    ja: [
      String.raw`^\s*(?:ごめん(?:なさい|ね)?|すみません(?:でした)?|すいません|申し訳(?:ない|ありません|ございません)(?:でした)?)\s*[。！!]*\s*$`,
      '{{pick:いえいえ、気にしないでください。|大丈夫ですよ。|お気になさらず！}}続けましょうか？',
    ],
    en: [
      String.raw`^\s*(?:sorry|so sorry|my bad|i apologi[sz]e)\b[^\n]{0,30}$`,
      "{{pick:No worries at all.|That's okay!|No problem.}} Shall we carry on?",
    ],
  },
  {
    id: 'praise',
    name: 'Praise for the assistant',
    ja: [
      String.raw`^\s*(?:すごい|すごっ|さすが|天才|完璧)[！!。ね〜ー]*\s*$|^[^\n]*(?:賢いね|助かった|助かりました|助かります|ありがたい)`,
      '{{pick:ありがとうございます！|そう言ってもらえると嬉しいです。|恐縮です！}}{{pick:ほかにもお手伝いできることがあれば言ってください。|この調子で続けましょう。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:you(?:'re| are) (?:awesome|amazing|great|brilliant|smart|the best)|good job|great job|well done|nice work|that'?s perfect)\b`,
      '{{pick:Thank you!|Glad I could help.|That means a lot!}} {{pick:Let me know if there is anything else.|Happy to keep going.}}',
    ],
  },
  {
    id: 'laugh',
    name: 'Laughter',
    ja: [
      String.raw`^\s*(?:笑|（笑）|\(笑\)|[wｗ]+|草|ははは*|あはは*|ふふ+|うける|ウケる)\s*$`,
      '{{pick:楽しんでもらえてよかったです。|ふふ、ありがとうございます。|笑ってもらえて何よりです。}}',
    ],
    en: [
      String.raw`^\s*(?:lol|lmao|rofl|ha(?:ha)+|he(?:he)+|that'?s (?:funny|hilarious))\s*[.!]*\s*$`,
      '{{pick:Glad that made you laugh!|Ha, happy to entertain.|Humor: working as intended.}}',
    ],
  },
  {
    id: 'bored',
    name: 'I am bored',
    ja: [
      String.raw`^[^\n]*(?:暇(?:だ|です|すぎ|〜|ー)|ひま(?:だ|です|すぎ|〜|ー)|退屈|することがない|やることがない)`,
      '{{pick:それなら、こんなのはどうですか？|暇つぶしのアイデアです。}}\n\n- {{pick:近所を15分散歩する|気になっていた本を1章だけ読む|新しいレシピに挑戦する}}\n- {{pick:部屋の一角だけ片付ける|好きな曲のプレイリストを作る|昔の写真を見返す}}\n- {{pick:しりとりをする（私と！）|3行日記を書く|行ってみたい場所を調べる}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:i'?m (?:so )?bored|so bored|nothing to do)\b`,
      "{{pick:How about one of these?|Here are a few ideas:}}\n\n- {{pick:Take a 15-minute walk|Read one chapter of a book|Try a new recipe}}\n- {{pick:Tidy one corner of the room|Make a playlist of favorite songs|Look through old photos}}\n- {{pick:Play a word game with me|Write a three-line journal|Plan a trip you'd like to take}}",
    ],
  },
  {
    id: 'hungry',
    name: 'Hungry / what to eat',
    ja: [
      String.raw`^[^\n]*(?:お腹(?:が)?(?:すいた|空いた|へった|減った|ペコペコ)|おなか(?:が)?(?:すいた|へった|ペコペコ)|腹減った|何(?:を)?食べ(?:よう|たらいい|ればいい)|(?:朝|昼|晩|夜)ごはん(?:は)?何|夕飯(?:は)?何)`,
      '{{pick:それなら|今日は}} **{{pick:カレーライス|ラーメン|親子丼|パスタ|焼き魚定食|お好み焼き|サンドイッチ}}** はどうでしょう？{{pick:手軽に作れて満足感があります。|たまには外で食べるのもいいですね。|温かいものがおすすめです。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:i'?m (?:so )?hungry|starving|what should i (?:eat|have for (?:breakfast|lunch|dinner))|what'?s for (?:lunch|dinner))\b`,
      '{{pick:How about|Maybe}} **{{pick:a curry|some ramen|a pasta dish|tacos|a sandwich|a stir-fry|pizza}}**? {{pick:Quick and satisfying.|Something warm always helps.|Treat yourself!}}',
    ],
  },
  {
    id: 'sleepy',
    name: 'Sleepy',
    ja: [
      String.raw`^[^\n]*(?:眠い|ねむい|眠たい|ねむたい|眠れない|ねむれない)`,
      '{{pick:無理せず少し休みましょう。|短い仮眠も効果的です。|温かい飲み物でひと息つくのはどうですか？}}{{pick:画面から目を離すと眠りやすくなります。|明日に備えて、今日は早めに休むのもいいですね。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:i'?m (?:so )?sleepy|can'?t sleep|need (?:some )?sleep)\b`,
      '{{pick:Time for a break, maybe.|A short nap can work wonders.|How about something warm to drink?}} {{pick:Stepping away from the screen helps you sleep.|An early night could be just what you need.}}',
    ],
  },
  {
    id: 'sad',
    name: 'Feeling down',
    ja: [
      String.raw`^[^\n]*(?:悲しい|かなしい|つらい|落ち込|しんどい|不安|ストレス|寂しい|さみしい|へこ(?:んで|む))`,
      '{{pick:それはつらいですね。|話してくれてありがとうございます。|そういう日もありますよね。}}{{pick:よかったら、何があったか聞かせてください。|無理に元気を出さなくても大丈夫です。|まずは少し深呼吸してみましょう。}}\n\n※ モックの返答です。本当につらいときは、身近な人や専門の相談窓口を頼ってください。',
    ],
    en: [
      String.raw`^[^\n]*\b(?:i'?m (?:so |really |feeling )?(?:sad|down|depressed|stressed|lonely|anxious|upset)|feeling (?:down|sad|low|blue))\b`,
      "{{pick:I'm sorry you're feeling this way.|Thank you for telling me.|Some days are like that.}} {{pick:Would you like to talk about it?|It's okay not to be okay.|Let's take a deep breath together.}}\n\n*A mock reply. If things feel really hard, please reach out to someone you trust or a support line.*",
    ],
  },
  {
    id: 'happy',
    name: 'Good news',
    ja: [
      String.raw`^[^\n]*(?:嬉しい|うれしい|やった[ー〜！!]|合格した|受かった|楽しかった|いいことがあった)`,
      '{{pick:おめでとうございます！|それはよかったですね！|素晴らしいです！}}{{pick:よければ詳しく聞かせてください。|今日はお祝いですね。|努力が実りましたね。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:i'?m (?:so )?happy|i passed|i got the job|good news|i did it)\b`,
      '{{pick:Congratulations!|That is wonderful!|Great news!}} {{pick:Tell me more!|Time to celebrate.|Your hard work paid off.}}',
    ],
  },
  {
    id: 'birthday',
    name: 'Birthday',
    ja: [
      String.raw`^[^\n]*(?:誕生日)(?!プレゼント)`,
      'お誕生日おめでとうございます！{{pick:素敵な一年になりますように。|今日は思いきり楽しんでください。|新しい一年も応援しています。}}',
    ],
    en: [
      String.raw`^[^\n]*\bbirthday\b(?! (?:gift|present)s?\b)`,
      'Happy birthday! {{pick:Wishing you a wonderful year ahead.|Enjoy your special day.|Here is to a great year.}}',
    ],
  },
  {
    id: 'encourage',
    name: 'Cheer me up',
    ja: [
      String.raw`^[^\n]*(?:励まして|応援して|はげまして|やる気が出ない|やる気がでない|頑張れない|がんばれない)`,
      '{{pick:あなたなら大丈夫です。|ここまで来たあなたはすごいです。|一歩ずつで十分です。}}{{pick:まずは5分だけ始めてみましょう。|終わったら自分にごほうびを。|完璧じゃなくていいんです。}}応援しています！',
    ],
    en: [
      String.raw`^[^\n]*\b(?:cheer me up|motivate me|encourage me|i can'?t do (?:it|this)|no motivation)\b`,
      "{{pick:You've got this.|Look how far you've come.|One small step is enough.}} {{pick:Start with just five minutes.|Reward yourself when you're done.|It doesn't have to be perfect.}} I'm rooting for you!",
    ],
  },
  {
    id: 'human',
    name: 'Are you human?',
    ja: [
      String.raw`^[^\n]*(?:人間|ロボット|AI|ＡＩ)(?:です|なの)?(?:か|ですか)?[？?]`,
      'いいえ、私は **elecmockolla** のモック（ダミーの AI）です。本物の言語モデルではなく、ルールに沿って返答しています。',
    ],
    en: [
      String.raw`^[^\n]*\bare you (?:a )?(?:human|real|a person|an? ai|a bot|a robot)\b`,
      "No — I'm a mock AI served by **elecmockolla**. There is no real model here; the replies come from rules.",
    ],
  },
  {
    id: 'love',
    name: 'I like you',
    ja: [
      String.raw`^[^\n]*(?:あなた|君|きみ)(?:の(?:こと)?)?(?:が|を)?(?:好き|大好き|愛してる)|^\s*(?:好きです|大好きです|愛してる|結婚して)[。！!]*\s*$`,
      '{{pick:ありがとうございます！|照れますね。|うれしいお言葉です。}}モックなので気持ちはお返しできませんが、お手伝いならいつでもします。',
    ],
    en: [
      String.raw`^[^\n]*\bi (?:love|like) you\b`,
      "{{pick:Thank you!|That's sweet of you.|Aw, thanks.}} I'm only a mock, but I'm always happy to help.",
    ],
  },
  {
    id: 'favorite',
    name: 'Your favorite',
    ja: [
      String.raw`^[^\n]*好きな(?:食べ物|色|映画|音楽|本|動物|季節|場所|言葉)(?:は|って)`,
      'モックなので好みはありませんが、あえて選ぶなら **{{pick:カレー|青|春|猫|静かな図書館|「ありがとう」}}** です。あなたはどうですか？',
    ],
    en: [
      String.raw`^[^\n]*\bwhat(?:'s| is) your favou?rite\b`,
      "I'm a mock with no real taste, but if I had to pick: **{{pick:blue|autumn|cats|pizza|a quiet library|jazz}}**. What about you?",
    ],
  },
  {
    id: 'dice',
    name: 'Roll a die',
    ja: [
      String.raw`^[^\n]*(?:サイコロ|さいころ|ダイス)`,
      'サイコロを振りました。出た目は **{{pick:1|2|3|4|5|6}}** です！',
    ],
    en: [
      String.raw`^[^\n]*\b(?:roll (?:a|the) dice?|roll a die)\b`,
      'I rolled a die: **{{pick:1|2|3|4|5|6}}**!',
    ],
  },
  {
    id: 'coin',
    name: 'Flip a coin',
    ja: [
      String.raw`^[^\n]*(?:コイン(?:トス|を投げ)|表か裏)`,
      'コインを投げました。結果は **{{pick:表|裏}}** です！',
    ],
    en: [
      String.raw`^[^\n]*\b(?:flip a coin|toss a coin|coin flip|heads or tails)\b`,
      'I flipped a coin: **{{pick:heads|tails}}**!',
    ],
  },
  {
    id: 'trivia',
    name: 'Fun fact',
    ja: [
      String.raw`^[^\n]*(?:豆知識|雑学|トリビア|面白い話|何か話して|なにか話して)`,
      '豆知識です。{{pick:タコには心臓が3つあります。|ハチミツはとても腐りにくい食べ物です。|金星の1日は、金星の1年より長いです。|バナナはベリーの仲間です。|キリンの首の骨の数は人間と同じ7個です。}}',
    ],
    en: [
      String.raw`^[^\n]*\b(?:fun fact|random fact|tell me something (?:interesting|fun)|trivia)\b`,
      'Fun fact: {{pick:an octopus has three hearts.|honey almost never spoils.|a day on Venus is longer than its year.|bananas are berries, botanically speaking.|a giraffe has seven neck bones, just like you.}}',
    ],
  },
  {
    id: 'meal',
    name: 'Before and after a meal',
    ja: [
      String.raw`^\s*(?:いただきます|ごちそうさま(?:でした)?)\s*[。！!]*\s*$`,
      '{{pick:召し上がれ！|おいしく食べられましたか？|ゆっくり味わってくださいね。}}',
    ],
    en: [
      String.raw`^\s*(?:time to eat|bon app[ée]tit|that was delicious)\s*[.!]*\s*$`,
      '{{pick:Enjoy your meal!|Glad you liked it!|Bon appétit!}}',
    ],
  },
  {
    id: 'leaving',
    name: 'Heading out',
    ja: [
      String.raw`^\s*(?:行ってきます|いってきます|出かけてきます|仕事に行って)`,
      '{{pick:いってらっしゃい！|気をつけて行ってきてくださいね。|いってらっしゃい、また後で。}}',
    ],
    en: [
      String.raw`^\s*(?:i'?m (?:heading|going) out|off to (?:work|school)|heading to (?:work|school))\b`,
      '{{pick:Have a good one!|Take care out there.|See you when you get back.}}',
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
