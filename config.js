// KoTalk の設定（公開してよい値だけを書く。APIキー・合言葉は絶対にここに書かない）
window.KOTALK_CONFIG = {
  // worker/ の Cloudflare Worker の URL（末尾の / は不要）。
  //   例: "https://kotalk-judge.<アカウント名>.workers.dev"
  // 空のままなら、AI判定も学習記録も使わず、これまでどおり端末の中だけで動く。
  apiBase: "",

  // 会話の返事を AI（Claude）で判定する
  aiJudge: true,

  // 学習記録（クラスコードで登録し、同意した人の分だけ保存する）。
  // Worker 側で CLASS_CODES と D1 を設定したときだけ働く。
  records: true,

  // 同意画面に表示する情報。【】の部分を必ず書き換えてから公開すること。
  consent: {
    // 東北大学の学生
    student: {
      org: "東北大学【部局・授業名】",
      manager: "【担当教員名】",
      contact: "【問い合わせ先メールアドレス】",
      retention: "【保存期間（例：2027年3月31日まで。その後は削除）】",
      grading: "【成績との関係（例：練習量を平常点の参考にします／成績評価には使いません）】",
      researcher: "東北大学【研究者名】",
      research: "【研究テーマ（例：日本語母語話者の韓国語会話練習における誤用の分析）】"
    },
    // TOFA の一般受講生
    general: {
      org: "TOFA【講座名】",
      manager: "【担当講師名】",
      contact: "【問い合わせ先メールアドレス】",
      retention: "【保存期間（例：講座終了後1年間。その後は削除）】",
      researcher: "東北大学【研究者名】",
      research: "【研究テーマ（例：日本語母語話者の韓国語会話練習における誤用の分析）】"
    }
  }
};
