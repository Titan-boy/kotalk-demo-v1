// 学習記録（Cloudflare D1）の登録・保存・削除・書き出し
// 対象は2種類: student（東北大学の学生） / general（TOFA の一般受講生）
// 選択肢の値はブラウザ側（app.js の PROFILE_OPTIONS）と同じにすること

export const GENDERS = { female: "女性", male: "男性", other: "その他", no_answer: "回答しない" };
export const AGE_GROUPS = {
  "10s": "10代", "20s": "20代", "30s": "30代", "40s": "40代", "50s": "50代",
  "60s": "60代", "70s+": "70代以上", no_answer: "回答しない"
};
export const EXPERIENCES = {
  lt6m: "半年未満", "6m-1y": "半年〜1年", "1-3y": "1〜3年", "3-5y": "3〜5年", "5y+": "5年以上", no_answer: "回答しない"
};
export const REGIONS = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県", "海外", "回答しない"
];
const TYPES = { student: "学生", general: "一般" };
const VERDICTS = ["ok", "almost", "ng", ""];
const JUDGED_BY = ["ai", "rule", "branch", "none"];

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v, min, max) => (Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : null);
const now = () => new Date().toISOString();
const TOKEN_RE = /^[A-Za-z0-9-]{16,64}$/;

// "TU-KR2026A:student,TOFA-K1:general" → { "TU-KR2026A": "student", ... }
export function classCodes(env) {
  const map = {};
  (env.CLASS_CODES || "").split(",").forEach(item => {
    const [code, type] = item.split(":").map(s => (s || "").trim());
    if (/^[A-Za-z0-9-]{2,32}$/.test(code) && TYPES[type]) map[code.toUpperCase()] = type;
  });
  return map;
}

// クラスコードが使えるか（登録画面で先に確かめる）
export function checkClass(env, body) {
  const code = str(body && body.class_code, 32).toUpperCase();
  const type = classCodes(env)[code];
  return type ? { ok: true, class_code: code, learner_type: type } : { ok: false };
}

// 学習者の登録（同じ端末からの再登録は上書き＝同意の変更もこれで行う）
export async function register(env, body) {
  const token = str(body && body.device_token, 64);
  if (!TOKEN_RE.test(token)) return { status: 400, data: { error: "bad_token" } };
  const cls = checkClass(env, body);
  if (!cls.ok) return { status: 404, data: { error: "unknown_class" } };
  if (body.learner_type !== cls.learner_type) return { status: 400, data: { error: "type_mismatch" } };
  const learnerId = str(body.learner_id, 30);
  if (!learnerId) return { status: 400, data: { error: "no_learner_id" } };
  if (cls.learner_type === "student" && !/^[A-Za-z0-9-]{3,20}$/.test(learnerId)) {
    return { status: 400, data: { error: "bad_student_id" } };
  }
  const p = (cls.learner_type === "general" && body.profile) || {};
  const pick = (v, allowed) => (allowed.includes(v) ? v : null);
  const profile = cls.learner_type === "general"
    ? {
        gender: pick(p.gender, Object.keys(GENDERS)),
        age_group: pick(p.age_group, Object.keys(AGE_GROUPS)),
        experience: pick(p.experience, Object.keys(EXPERIENCES)),
        region: pick(p.region, REGIONS)
      }
    : { gender: null, age_group: null, experience: null, region: null };
  if (cls.learner_type === "general" && Object.values(profile).some(v => v === null)) {
    return { status: 400, data: { error: "bad_profile" } };
  }
  const t = now();
  await env.DB.prepare(
    `INSERT INTO learners (device_token, class_code, learner_type, learner_id, research_ok, gender, age_group, experience, region, registered_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
     ON CONFLICT(device_token) DO UPDATE SET
       class_code = excluded.class_code, learner_type = excluded.learner_type, learner_id = excluded.learner_id,
       research_ok = excluded.research_ok, gender = excluded.gender, age_group = excluded.age_group,
       experience = excluded.experience, region = excluded.region, updated_at = excluded.updated_at`
  ).bind(token, cls.class_code, cls.learner_type, learnerId, body.research_ok === true ? 1 : 0,
    profile.gender, profile.age_group, profile.experience, profile.region, t).run();
  return { status: 200, data: { ok: true, learner_type: cls.learner_type } };
}

// 返事1回分（登録済みの端末からだけ受け付ける）
export async function saveReply(env, body) {
  const token = str(body && body.device_token, 64);
  if (!TOKEN_RE.test(token)) return { status: 400, data: { error: "bad_token" } };
  const verdict = VERDICTS.includes(body.verdict) ? body.verdict : "";
  const judgedBy = JUDGED_BY.includes(body.judged_by) ? body.judged_by : "none";
  const r = await env.DB.prepare(
    `INSERT INTO replies (created_at, device_token, theme, level, turn_no, try_no, partner_ko, reply_ko, voice, verdict, judged_by, feedback_ja, corrected_ko, branch_id)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
     WHERE EXISTS (SELECT 1 FROM learners WHERE device_token = ?2)`
  ).bind(now(), token, str(body.theme, 40), str(body.level, 10), int(body.turn_no, 0, 50), int(body.try_no, 1, 20),
    str(body.partner_ko, 300), str(body.reply_ko, 300), body.voice === true ? 1 : 0, verdict, judgedBy,
    str(body.feedback_ja, 400), str(body.corrected_ko, 300), str(body.branch_id, 40)).run();
  return r.meta && r.meta.changes ? { status: 200, data: { ok: true } } : { status: 404, data: { error: "not_registered" } };
}

// 会話1回分のまとめ
export async function saveSession(env, body) {
  const token = str(body && body.device_token, 64);
  if (!TOKEN_RE.test(token)) return { status: 400, data: { error: "bad_token" } };
  const r = await env.DB.prepare(
    `INSERT INTO sessions (created_at, device_token, theme, level, seconds, turns, ok_count, finished)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
     WHERE EXISTS (SELECT 1 FROM learners WHERE device_token = ?2)`
  ).bind(now(), token, str(body.theme, 40), str(body.level, 10), int(body.seconds, 0, 86400),
    int(body.turns, 0, 200), int(body.ok_count, 0, 200), body.finished === true ? 1 : 0).run();
  return r.meta && r.meta.changes ? { status: 200, data: { ok: true } } : { status: 404, data: { error: "not_registered" } };
}

// 本人による登録解除と記録の削除
export async function deleteLearner(env, body) {
  const token = str(body && body.device_token, 64);
  if (!TOKEN_RE.test(token)) return { status: 400, data: { error: "bad_token" } };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM replies WHERE device_token = ?1").bind(token),
    env.DB.prepare("DELETE FROM sessions WHERE device_token = ?1").bind(token),
    env.DB.prepare("DELETE FROM learners WHERE device_token = ?1").bind(token)
  ]);
  return { status: 200, data: { ok: true } };
}

// ===== 教員用の CSV 書き出し =====
// GET /export?key=<EXPORT_KEY>&class=<コード>&table=replies|sessions|learners&research=1
//   research=1: 研究への利用に同意した人だけにし、学籍番号・ニックネームを仮IDに置き換える

const csvCell = v => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header, rows) => "\uFEFF" + [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// 合言葉の比較（長さ・内容で時間差が出にくいようにハッシュ同士を比べる）
export async function keyMatches(given, expected) {
  if (!expected || !given) return false;
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function exportCsv(env, url) {
  const table = url.searchParams.get("table") || "replies";
  const code = (url.searchParams.get("class") || "").toUpperCase();
  const research = url.searchParams.get("research") === "1";
  if (!["replies", "sessions", "learners"].includes(table)) return null;
  if (!classCodes(env)[code]) return null;

  const where = research ? "l.class_code = ?1 AND l.research_ok = 1" : "l.class_code = ?1";
  const learnerCols = "l.class_code, l.learner_type, l.learner_id, l.research_ok, l.gender, l.age_group, l.experience, l.region";
  let sql;
  if (table === "learners") sql = `SELECT ${learnerCols}, l.registered_at, l.updated_at FROM learners l WHERE ${where} ORDER BY l.registered_at`;
  if (table === "replies") sql = `SELECT ${learnerCols}, r.created_at, r.theme, r.level, r.turn_no, r.try_no, r.partner_ko, r.reply_ko, r.voice, r.verdict, r.judged_by, r.branch_id, r.feedback_ja, r.corrected_ko FROM replies r JOIN learners l ON l.device_token = r.device_token WHERE ${where} ORDER BY r.created_at`;
  if (table === "sessions") sql = `SELECT ${learnerCols}, s.created_at, s.theme, s.level, s.seconds, s.turns, s.ok_count, s.finished FROM sessions s JOIN learners l ON l.device_token = s.device_token WHERE ${where} ORDER BY s.created_at`;
  const { results } = await env.DB.prepare(sql).bind(code).all();

  const pseudo = {};
  const rows = [];
  for (const r of results) {
    let id = r.learner_id;
    if (research) {
      // 書き出すたびに同じ仮IDになるよう、合言葉を混ぜたハッシュから作る（元の番号には戻せない）
      pseudo[id] = pseudo[id] || "P-" + (await sha256Hex(`${env.EXPORT_KEY}|${r.class_code}|${id}`)).slice(0, 10);
      id = pseudo[id];
    }
    const base = [r.class_code, TYPES[r.learner_type] || r.learner_type, id, r.research_ok ? "同意" : "なし",
      GENDERS[r.gender] || "", AGE_GROUPS[r.age_group] || "", EXPERIENCES[r.experience] || "", r.region || ""];
    if (table === "learners") rows.push([...base, r.registered_at, r.updated_at]);
    if (table === "replies") rows.push([...base, r.created_at, r.theme, r.level, r.turn_no, r.try_no, r.partner_ko, r.reply_ko,
      r.voice ? "声" : "文字", r.verdict, r.judged_by, r.branch_id, r.feedback_ja, r.corrected_ko]);
    if (table === "sessions") rows.push([...base, r.created_at, r.theme, r.level, r.seconds, r.turns, r.ok_count, r.finished ? "最後まで" : "途中"]);
  }
  const head = ["クラス", "区分", research ? "仮ID" : "学籍番号/ニックネーム", "研究への同意", "性別", "年代", "学習歴", "地域"];
  const header = {
    learners: [...head, "登録日時(UTC)", "更新日時(UTC)"],
    replies: [...head, "日時(UTC)", "テーマ", "レベル", "ターン", "何回目", "相手のセリフ", "返事", "入力", "判定", "判定方法", "分かれ道", "AIの助言", "直した文"],
    sessions: [...head, "日時(UTC)", "テーマ", "レベル", "練習秒数", "やりとり数", "通じた数", "終了"]
  }[table];
  return { csv: toCsv(header, rows), filename: `kotalk-${code}-${table}${research ? "-research" : ""}.csv` };
}
