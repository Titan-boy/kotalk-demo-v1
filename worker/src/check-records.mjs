// 学習記録の動作確認（Cloudflare には接続しない）
// node:sqlite で D1 と同じ形の小さな代役を作り、migrations の SQL をそのまま流して確かめる。
//   実行: node src/check-records.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "./index.js";

// ---- D1 の代役（prepare / bind / run / all / batch だけ） ----
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_records.sql", import.meta.url), "utf8"));
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    run: async () => {
      const r = db.prepare(sql.replace(/\?(\d+)/g, "?")).run(...expand(sql, params));
      return { meta: { changes: Number(r.changes) } };
    },
    all: async () => ({ results: db.prepare(sql.replace(/\?(\d+)/g, "?")).all(...expand(sql, params)) })
  });
  // D1 の ?1 ?2 … を、node:sqlite が受け取れる並びに直す
  const expand = (sql, params) => [...sql.matchAll(/\?(\d+)/g)].map(m => params[Number(m[1]) - 1]);
  return { prepare: sql => stmt(sql), batch: async list => { for (const s of list) await s.run(); }, raw: db };
}

const ORIGIN = "https://titan-boy.github.io";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  CLASS_CODES: "TU-KR2026A:student, TOFA-K1:general, bad code:student",
  EXPORT_KEY: "teacher-secret-key",
  DB: fakeD1()
};
const post = (path, body) => worker.fetch(new Request(`https://w.example${path}`, {
  method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify(body)
}), env);
const get = path => worker.fetch(new Request(`https://w.example${path}`), env);
const tokS = "student-token-0000000001";
const tokG = "general-token-0000000002";
const tokG2 = "general-token-0000000003";
const profile = { gender: "female", age_group: "40s", experience: "1-3y", region: "宮城県" };

// クラスコード
assert.equal((await post("/records/class", { class_code: "tu-kr2026a" })).status, 200);
assert.deepEqual(await (await post("/records/class", { class_code: "TOFA-K1" })).json(), { ok: true, class_code: "TOFA-K1", learner_type: "general" });
assert.equal((await post("/records/class", { class_code: "NOPE" })).status, 404);

// 登録：学生
assert.equal((await post("/records/register", { device_token: tokS, class_code: "TU-KR2026A", learner_type: "student", learner_id: "C1SB1234", research_ok: false })).status, 200);
// 登録：学籍番号の形がおかしい / 区分がクラスと違う
assert.equal((await post("/records/register", { device_token: tokS, class_code: "TU-KR2026A", learner_type: "student", learner_id: "あいう", research_ok: false })).status, 400);
assert.equal((await post("/records/register", { device_token: tokS, class_code: "TU-KR2026A", learner_type: "general", learner_id: "x", profile })).status, 400);
// 登録：一般（属性が足りなければ拒否）
assert.equal((await post("/records/register", { device_token: tokG, class_code: "TOFA-K1", learner_type: "general", learner_id: "さくら", research_ok: true, profile: { ...profile, region: "火星" } })).status, 400);
assert.equal((await post("/records/register", { device_token: tokG, class_code: "TOFA-K1", learner_type: "general", learner_id: "さくら", research_ok: true, profile })).status, 200);
assert.equal((await post("/records/register", { device_token: tokG2, class_code: "TOFA-K1", learner_type: "general", learner_id: "たろう", research_ok: false, profile: { gender: "no_answer", age_group: "no_answer", experience: "no_answer", region: "回答しない" } })).status, 200);

// 記録
const reply = { theme: "週末の約束", level: "中級", turn_no: 0, try_no: 1, partner_ko: "이번 주말에 뭐 해요?", reply_ko: "쇼핑하러 가요, \"진짜\"", voice: false, verdict: "ok", judged_by: "ai", feedback_ja: "通じます。", corrected_ko: "쇼핑하러 가요." };
for (const t of [tokS, tokG, tokG2]) assert.equal((await post("/records/reply", { device_token: t, ...reply })).status, 200);
assert.equal((await post("/records/reply", { device_token: "unregistered-token-000099", ...reply })).status, 404);
assert.equal((await post("/records/session", { device_token: tokG, theme: "週末の約束", level: "中級", seconds: 300, turns: 5, ok_count: 4, finished: true })).status, 200);

// 書き出し：合言葉なし・違う合言葉は拒否
assert.equal((await get("/export?class=TOFA-K1")).status, 403);
assert.equal((await get("/export?class=TOFA-K1&key=wrong")).status, 403);
// 書き出し：通常（実名のニックネーム・属性つき）
let res = await get("/export?class=TOFA-K1&table=replies&key=teacher-secret-key");
assert.equal(res.status, 200);
const bytes = new Uint8Array(await res.arrayBuffer());
assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "Excel で文字化けしないよう BOM を付ける");
let csv = new TextDecoder().decode(bytes);
assert.ok(csv.startsWith("クラス,区分,学籍番号/ニックネーム"));
assert.match(csv, /TOFA-K1,一般,さくら,同意,女性,40代,1〜3年,宮城県/);
assert.match(csv, /"쇼핑하러 가요, ""진짜"""/);
assert.ok(!csv.includes(tokG), "端末トークンは書き出さない");
assert.ok(!csv.includes("C1SB1234"), "他のクラスは含めない");
// 書き出し：研究用（同意した人だけ、仮ID）
res = await get("/export?class=TOFA-K1&table=replies&research=1&key=teacher-secret-key");
csv = await res.text();
assert.ok(!csv.includes("さくら") && !csv.includes("たろう"));
assert.match(csv, /TOFA-K1,一般,P-[0-9a-f]{10},同意,女性/);
assert.equal(csv.trim().split("\r\n").length, 2, "同意した1人分だけ");
// 同意を取り消すと、過去の記録も研究用から外れる
await post("/records/register", { device_token: tokG, class_code: "TOFA-K1", learner_type: "general", learner_id: "さくら", research_ok: false, profile });
csv = await (await get("/export?class=TOFA-K1&table=replies&research=1&key=teacher-secret-key")).text();
assert.equal(csv.trim().split("\r\n").length, 1);
// 学生クラスの書き出し（属性は空）
csv = await (await get("/export?class=TU-KR2026A&table=learners&key=teacher-secret-key")).text();
assert.match(csv, /TU-KR2026A,学生,C1SB1234,なし,,,,,/);

// 分かれ道の記録（判定方法 branch と、当たった分かれ道の id）
assert.equal((await post("/records/reply", { device_token: tokS, ...reply, verdict: "almost", judged_by: "branch", branch_id: "pharmacy", reply_ko: "약국이 어디에 있어요?" })).status, 200);
csv = await (await get("/export?class=TU-KR2026A&table=replies&key=teacher-secret-key")).text();
assert.match(csv, /약국이 어디에 있어요\?,文字,almost,branch,pharmacy,/);

// 本人による削除
assert.equal((await post("/records/delete", { device_token: tokG })).status, 200);
const left = env.DB.raw.prepare("SELECT (SELECT COUNT(*) FROM learners WHERE device_token = ?) a, (SELECT COUNT(*) FROM replies WHERE device_token = ?) b, (SELECT COUNT(*) FROM sessions WHERE device_token = ?) c").get(tokG, tokG, tokG);
assert.deepEqual([left.a, left.b, left.c], [0, 0, 0]);

// DB が無い（記録を使わない）設定でも判定 API には影響しない
const noDb = await worker.fetch(new Request("https://w.example/records/class", { method: "POST", headers: { Origin: ORIGIN }, body: "{}" }), { ...env, DB: undefined });
assert.equal(noDb.status, 503);

console.log("records check: OK");
