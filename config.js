// KoTalk の設定（公開してよい値だけを書く。APIキーは絶対にここに書かない）
window.KOTALK_CONFIG = {
  // 会話の返事を AI（Claude）で判定するときの接続先。
  // worker/ の Cloudflare Worker を公開したら、その URL の末尾に /judge を付けて入れる。
  //   例: "https://kotalk-judge.<アカウント名>.workers.dev/judge"
  // 空のままなら、これまでの簡易判定（文末・キーワード）だけで動く。
  aiEndpoint: ""
};
