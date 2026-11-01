-- KoTalk の学習記録（クラスコードを登録し、同意した学習者の分だけ保存する）
-- 学習者は2種類: student（東北大学の学生） / general（TOFA の一般受講生）
-- device_token: 端末ごとの乱数。記録をこの学習者に結び付け、本人が削除・同意変更するときの確認に使う（書き出しには含めない）

CREATE TABLE IF NOT EXISTS learners (
  device_token TEXT PRIMARY KEY,
  class_code TEXT NOT NULL,
  learner_type TEXT NOT NULL,          -- student / general
  learner_id TEXT NOT NULL,            -- student: 学籍番号 / general: ニックネーム
  research_ok INTEGER NOT NULL DEFAULT 0,
  gender TEXT,                         -- general のみ（female / male / other / no_answer）
  age_group TEXT,                      -- general のみ（10s … 70s+ / no_answer）
  experience TEXT,                     -- general のみ（学習歴）
  region TEXT,                         -- general のみ（都道府県・海外 / no_answer）
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learners_class ON learners (class_code);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  device_token TEXT NOT NULL,
  theme TEXT,
  level TEXT,
  turn_no INTEGER,
  try_no INTEGER,
  partner_ko TEXT,
  reply_ko TEXT,
  voice INTEGER NOT NULL DEFAULT 0,
  verdict TEXT,          -- ok / almost / ng（AI）、ok / ng（簡易判定）、空＝判定なし（文字起こし不可の録音）
  judged_by TEXT,        -- ai / rule / branch（分かれ道シナリオ） / none
  feedback_ja TEXT,
  corrected_ko TEXT,
  branch_id TEXT         -- 当たった分かれ道（branches.js の id）。空＝決まった流れ・AI・簡易判定
);
CREATE INDEX IF NOT EXISTS idx_replies_token ON replies (device_token);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  device_token TEXT NOT NULL,
  theme TEXT,
  level TEXT,
  seconds INTEGER,
  turns INTEGER,
  ok_count INTEGER,
  finished INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (device_token);
