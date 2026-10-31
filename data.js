// 例文データ（日本人中級学習者向け）
// audio: お手本音声（ElevenLabs「Soo - Warm Korean Teacher」で生成）
// theme / level: レッスン一覧に表示するテーマと難易度
// words: 単語練習・単語クイズ用の10語（inSentence: 例文に出てくる4語 ／ それ以外: 関連する新しい6語）
//   kana: カタカナ発音表記 / audio: 単語音声（ElevenLabs 生成）/ exKo・exJa: 関連語の例文（例文の単語はレッスンの例文を使う）
// expl: 「表現を確認」で表示する日本語の解説（summary: 文の意味と使う場面 / grammar: 文法ポイント）
// points: 発音のポイント（ja: 説明, ko: 韓国語での説明）
window.SENTENCES = [
  {
    ko: "주말에 시간 있으면 같이 영화 보러 갈래요?",
    expl: {
      summary: "「週末に時間があったら、一緒に映画を見に行きませんか？」と、相手を気軽に誘う表現です。友人や同僚など、親しい相手に丁寧に（해요体で）誘うときに使います。",
      grammar: [
        { form: "주말에", ja: "名詞＋에 で「〜に」。時を表します（주말에＝週末に、아침에＝朝に）。" },
        { form: "있으면（-(으)면）", ja: "「〜なら・〜たら」という条件・仮定。パッチムがあれば -으면、なければ -면（있다→있으면、가다→가면）。" },
        { form: "보러 가다（-(으)러 가다）", ja: "「〜しに行く」。移動の目的を表します（보다→보러 가다、먹다→먹으러 가다）。" },
        { form: "갈래요?（-(으)ㄹ래요?）", ja: "相手の意向をたずねる「〜しませんか？／〜しますか？」。親しい相手への誘いに使い、目上の人には 가실래요? がより丁寧です。" }
      ]
    },
    audio: "audio/1.mp3",
    ja: "週末に時間があったら、一緒に映画を見に行きませんか？",
    theme: "誘う・週末",
    level: "★★☆",
    words: [
      { ko: "주말", ja: "週末", kana: "ジュマル", audio: "audio/words/1-1.mp3", inSentence: true },
      { ko: "시간", ja: "時間", kana: "シガン", audio: "audio/words/1-2.mp3", inSentence: true },
      { ko: "같이", ja: "一緒に", kana: "ガチ", audio: "audio/words/1-3.mp3", inSentence: true },
      { ko: "영화", ja: "映画", kana: "ヨンファ", audio: "audio/words/1-4.mp3", inSentence: true },
      { ko: "극장", ja: "映画館", kana: "グッチャン", audio: "audio/words/1-5.mp3", exKo: "극장에서 영화를 봐요.", exJa: "映画館で映画を見ます。" },
      { ko: "표", ja: "チケット", kana: "ピョ", audio: "audio/words/1-6.mp3", exKo: "표를 두 장 샀어요.", exJa: "チケットを2枚買いました。" },
      { ko: "약속", ja: "約束", kana: "ヤクソク", audio: "audio/words/1-7.mp3", exKo: "오늘 친구하고 약속이 있어요.", exJa: "今日は友達と約束があります。" },
      { ko: "예매하다", ja: "（チケットを）予約する", kana: "イェメハダ", audio: "audio/words/1-8.mp3", exKo: "인터넷으로 표를 예매했어요.", exJa: "ネットでチケットを予約しました。" },
      { ko: "한가하다", ja: "暇だ", kana: "ハンガハダ", audio: "audio/words/1-9.mp3", exKo: "주말에는 좀 한가해요.", exJa: "週末は少し暇です。" },
      { ko: "개봉하다", ja: "（映画が）公開される", kana: "ゲボンハダ", audio: "audio/words/1-10.mp3", exKo: "그 영화는 다음 주에 개봉해요.", exJa: "その映画は来週公開されます。" }
    ],
    points: [
      { mark: "있으면 [이쓰면]", ja: "パッチムㅆは次の母音にくっついて[쓰]と強く発音します。", ko: "받침 ㅆ은 뒤 모음과 이어서 [쓰]로 발음해요." },
      { mark: "같이 [가치]", ja: "ㅌ+이 は[치]に変わります（口蓋音化）。「ガティ」にならないように。", ko: "ㅌ 뒤에 '이'가 오면 [치]로 바뀌어요. 구개음화예요." }
    ]
  },
  {
    ko: "어제 너무 피곤해서 일찍 잤어요.",
    expl: {
      summary: "「昨日とても疲れていたので、早く寝ました」。理由と結果を一文で述べる、日常会話でよく使う形です。",
      grammar: [
        { form: "너무", ja: "本来は「〜すぎる」ですが、会話では「とても」の強調として広く使われます。" },
        { form: "피곤해서（-아서/어서）", ja: "「〜ので・〜くて」と理由を表します。하다は 해서 になります。後ろに命令・勧誘は続けられません（×피곤해서 쉬세요 → ○피곤하니까 쉬세요）。" },
        { form: "잤어요（-았/었어요）", ja: "過去形「〜しました」。자다＋았어요 → 잤어요 と縮まります。" }
      ]
    },
    audio: "audio/2.mp3",
    ja: "昨日とても疲れていたので、早く寝ました。",
    theme: "日常・体調",
    level: "★★☆",
    words: [
      { ko: "어제", ja: "昨日", kana: "オジェ", audio: "audio/words/2-1.mp3", inSentence: true },
      { ko: "피곤하다", ja: "疲れている", kana: "ピゴナダ", audio: "audio/words/2-2.mp3", inSentence: true },
      { ko: "일찍", ja: "早く", kana: "イルッチク", audio: "audio/words/2-3.mp3", inSentence: true },
      { ko: "자다", ja: "寝る", kana: "ジャダ", audio: "audio/words/2-4.mp3", inSentence: true },
      { ko: "늦게", ja: "遅く", kana: "ヌッケ", audio: "audio/words/2-5.mp3", exKo: "어젯밤에 늦게 잤어요.", exJa: "昨夜は遅く寝ました。" },
      { ko: "졸리다", ja: "眠い", kana: "ジョルリダ", audio: "audio/words/2-6.mp3", exKo: "너무 졸려요.", exJa: "とても眠いです。" },
      { ko: "푹 쉬다", ja: "ゆっくり休む", kana: "プク シュィダ", audio: "audio/words/2-7.mp3", exKo: "주말에 푹 쉬세요.", exJa: "週末はゆっくり休んでください。" },
      { ko: "야근", ja: "残業", kana: "ヤグン", audio: "audio/words/2-8.mp3", exKo: "오늘도 야근해요.", exJa: "今日も残業です。" },
      { ko: "일어나다", ja: "起きる", kana: "イロナダ", audio: "audio/words/2-9.mp3", exKo: "아침 7시에 일어나요.", exJa: "朝7時に起きます。" },
      { ko: "잠이 들다", ja: "眠りにつく", kana: "ジャミ ドゥルダ", audio: "audio/words/2-10.mp3", exKo: "책을 읽다가 잠이 들었어요.", exJa: "本を読んでいるうちに眠ってしまいました。" }
    ],
    points: [
      { mark: "피곤해서 [피고내서]", ja: "会話ではㅎが弱まり[피고내서]に近く聞こえます。", ko: "자연스러운 대화에서는 ㅎ이 약해져서 [피고내서]처럼 들려요." },
      { mark: "일찍 [일찍]", ja: "ㅉは息を出さず、喉を詰めるように短く鋭く。", ko: "ㅉ은 숨을 내보내지 말고 짧고 강하게 발음해요." }
    ]
  },
  {
    ko: "한국 음식 중에서 뭘 제일 좋아해요?",
    expl: {
      summary: "「韓国料理の中で何がいちばん好きですか？」。好みをたずねる定番の質問で、会話のきっかけによく使います。",
      grammar: [
        { form: "중에서", ja: "名詞＋중에서 で「〜の中で」。範囲を限定します。" },
        { form: "뭘", ja: "무엇을（何を）の縮約形。会話では 뭘・뭐를 が自然です。" },
        { form: "제일", ja: "「いちばん」。가장 とほぼ同じ意味で、会話では 제일 がよく使われます。" },
        { form: "좋아하다＋을/를", ja: "「〜が好きだ」。日本語では「が」ですが、좋아하다 は目的語の 을/를 をとります（○뭘 좋아해요? ×뭐가 좋아해요?）。" }
      ]
    },
    audio: "audio/3.mp3",
    ja: "韓国料理の中で何がいちばん好きですか？",
    theme: "食べ物・好み",
    level: "★★☆",
    words: [
      { ko: "음식", ja: "料理・食べ物", kana: "ウムシク", audio: "audio/words/3-1.mp3", inSentence: true },
      { ko: "중에서", ja: "〜の中で", kana: "ジュンエソ", audio: "audio/words/3-2.mp3", inSentence: true },
      { ko: "제일", ja: "いちばん", kana: "ジェイル", audio: "audio/words/3-3.mp3", inSentence: true },
      { ko: "좋아하다", ja: "好きだ", kana: "ジョアハダ", audio: "audio/words/3-4.mp3", inSentence: true },
      { ko: "맵다", ja: "辛い", kana: "メプタ", audio: "audio/words/3-5.mp3", exKo: "이 김치는 좀 매워요.", exJa: "このキムチは少し辛いです。" },
      { ko: "달다", ja: "甘い", kana: "ダルダ", audio: "audio/words/3-6.mp3", exKo: "이 케이크는 너무 달아요.", exJa: "このケーキは甘すぎます。" },
      { ko: "짜다", ja: "しょっぱい", kana: "ッチャダ", audio: "audio/words/3-7.mp3", exKo: "국이 좀 짜요.", exJa: "スープが少ししょっぱいです。" },
      { ko: "맛", ja: "味", kana: "マッ", audio: "audio/words/3-8.mp3", exKo: "맛이 어때요?", exJa: "味はどうですか？" },
      { ko: "반찬", ja: "おかず", kana: "バンチャン", audio: "audio/words/3-9.mp3", exKo: "반찬이 정말 많네요.", exJa: "おかずが本当に多いですね。" },
      { ko: "입에 맞다", ja: "口に合う", kana: "イベ マッタ", audio: "audio/words/3-10.mp3", exKo: "한국 음식이 입에 맞아요?", exJa: "韓国料理は口に合いますか？" }
    ],
    points: [
      { mark: "좋아해요 [조아해요]", ja: "パッチムㅎの後に母音が来るとㅎは発音しません。", ko: "받침 ㅎ 뒤에 모음이 오면 ㅎ은 소리가 나지 않아요." },
      { mark: "음식 [음식]", ja: "パッチムㅁは口をしっかり閉じて。日本語の「ん」で代用しないように。", ko: "받침 ㅁ은 입술을 꼭 닫고 발음해요." }
    ]
  },
  {
    ko: "다음 주까지 연락드릴게요.",
    expl: {
      summary: "「来週までにご連絡します」。仕事相手や目上の人に、期限を示して約束するときの丁寧な表現です。",
      grammar: [
        { form: "까지", ja: "「〜まで」。日本語の「〜までに」（期限）も 까지 で表します。" },
        { form: "연락드리다", ja: "연락하다（連絡する）の謙譲語「ご連絡差し上げる」。名詞＋드리다 で謙譲になります（전화드리다、말씀드리다）。" },
        { form: "-(으)ㄹ게요", ja: "話し手の意志・約束「〜しますね」。相手に向けて約束するニュアンスで、主語は「私」に限られます。発音は[께요]です。" }
      ]
    },
    audio: "audio/4.mp3",
    ja: "来週までにご連絡します。",
    theme: "仕事・連絡",
    level: "★★★",
    words: [
      { ko: "다음 주", ja: "来週", kana: "ダウム ジュ", audio: "audio/words/4-1.mp3", inSentence: true },
      { ko: "까지", ja: "〜まで", kana: "ッカジ", audio: "audio/words/4-2.mp3", inSentence: true },
      { ko: "연락", ja: "連絡", kana: "ヨルラク", audio: "audio/words/4-3.mp3", inSentence: true },
      { ko: "드리다", ja: "差し上げる", kana: "ドゥリダ", audio: "audio/words/4-4.mp3", inSentence: true },
      { ko: "지난주", ja: "先週", kana: "ジナンジュ", audio: "audio/words/4-5.mp3", exKo: "지난주에 서울에 갔어요.", exJa: "先週ソウルに行きました。" },
      { ko: "답장", ja: "返信", kana: "ダプチャン", audio: "audio/words/4-6.mp3", exKo: "답장이 늦어서 죄송해요.", exJa: "返信が遅くなってすみません。" },
      { ko: "확인하다", ja: "確認する", kana: "ファギナダ", audio: "audio/words/4-7.mp3", exKo: "메일을 확인해 주세요.", exJa: "メールを確認してください。" },
      { ko: "일정", ja: "日程", kana: "イルチョン", audio: "audio/words/4-8.mp3", exKo: "다음 주 일정이 어떻게 돼요?", exJa: "来週の日程はどうなっていますか？" },
      { ko: "늦어지다", ja: "遅れる", kana: "ヌジョジダ", audio: "audio/words/4-9.mp3", exKo: "회의가 좀 늦어질 것 같아요.", exJa: "会議が少し遅れそうです。" },
      { ko: "문자", ja: "（携帯の）メッセージ", kana: "ムンチャ", audio: "audio/words/4-10.mp3", exKo: "나중에 문자 보낼게요.", exJa: "あとでメッセージを送りますね。" }
    ],
    points: [
      { mark: "연락 [열락]", ja: "ㄴ+ㄹ は[ㄹㄹ]になります（流音化）。", ko: "ㄴ과 ㄹ이 만나면 [ㄹㄹ]로 발음해요. 유음화예요." },
      { mark: "드릴게요 [드릴께요]", ja: "-ㄹ게요 の게は濃音[께]で発音します。", ko: "'-ㄹ게요'의 '게'는 [께]로 발음해요." }
    ]
  },
  {
    ko: "이 근처에 맛있는 식당 있어요?",
    expl: {
      summary: "「この近くにおいしい食堂はありますか？」。旅行先などで店をたずねるときの定番表現です。",
      grammar: [
        { form: "이 근처에", ja: "「この近くに」。이＝この、에 は存在する場所を表します。" },
        { form: "맛있는（-는 連体形）", ja: "名詞を修飾する形。있다・없다 で終わる語は -는 を使います（맛있는 식당、재미있는 영화）。" },
        { form: "식당 있어요?", ja: "식당이 있어요? の 이（が）が省略された形。会話では助詞の省略がよく起こります。" }
      ]
    },
    audio: "audio/5.mp3",
    ja: "この近くにおいしい食堂はありますか？",
    theme: "外食・お店",
    level: "★★☆",
    words: [
      { ko: "근처", ja: "近く", kana: "グンチョ", audio: "audio/words/5-1.mp3", inSentence: true },
      { ko: "맛있다", ja: "おいしい", kana: "マシッタ", audio: "audio/words/5-2.mp3", inSentence: true },
      { ko: "식당", ja: "食堂", kana: "シクタン", audio: "audio/words/5-3.mp3", inSentence: true },
      { ko: "있다", ja: "ある・いる", kana: "イッタ", audio: "audio/words/5-4.mp3", inSentence: true },
      { ko: "맛집", ja: "人気のおいしい店", kana: "マッチプ", audio: "audio/words/5-5.mp3", exKo: "이 근처에 유명한 맛집이 있어요.", exJa: "この近くに有名なおいしい店があります。" },
      { ko: "메뉴", ja: "メニュー", kana: "メニュ", audio: "audio/words/5-6.mp3", exKo: "메뉴 좀 보여 주세요.", exJa: "メニューを見せてください。" },
      { ko: "주문하다", ja: "注文する", kana: "ジュムナダ", audio: "audio/words/5-7.mp3", exKo: "비빔밥 하나 주문할게요.", exJa: "ビビンバを一つ注文します。" },
      { ko: "예약하다", ja: "予約する", kana: "イェヤカダ", audio: "audio/words/5-8.mp3", exKo: "7시로 예약했어요.", exJa: "7時で予約しました。" },
      { ko: "자리", ja: "席", kana: "ジャリ", audio: "audio/words/5-9.mp3", exKo: "창가 자리 있어요?", exJa: "窓際の席はありますか？" },
      { ko: "추천하다", ja: "おすすめする", kana: "チュチョナダ", audio: "audio/words/5-10.mp3", exKo: "뭐 추천해 주실 수 있어요?", exJa: "何かおすすめしてもらえますか？" }
    ],
    points: [
      { mark: "맛있는 [마신는]", ja: "ㅆ+ㄴ で鼻音化し[신는]となります。", ko: "ㅆ 뒤에 ㄴ이 오면 비음화가 일어나 [신는]이 돼요." },
      { mark: "식당 [식땅]", ja: "パッチムㄱの後のㄷは濃音[ㄸ]になります。", ko: "받침 ㄱ 뒤의 ㄷ은 [ㄸ]으로 발음해요." }
    ]
  }
];
