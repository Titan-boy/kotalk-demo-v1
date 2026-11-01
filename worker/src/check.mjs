// Worker の動作確認（Claude API には接続しない）
// globalThis.fetch を差し替えて、送るリクエストの形と、CORS・入力チェックを確かめる。
//   実行: node src/check.mjs
import assert from "node:assert/strict";
import worker from "./index.js";

const env = { ANTHROPIC_API_KEY: "test-key", ALLOWED_ORIGINS: "https://titan-boy.github.io" };
const ORIGIN = "https://titan-boy.github.io";
let sent = null;
let reply = { verdict: "ok", feedback_ja: "通じます。", corrected_ko: "쇼핑하러 가요.", better_ko: "주말에 쇼핑하러 가요." };
let stopReason = "end_turn";

globalThis.fetch = async (url, init) => {
  sent = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
  return new Response(JSON.stringify({
    id: "msg_test", type: "message", role: "assistant", model: "claude-haiku-5-5",
    content: [{ type: "text", text: JSON.stringify(reply) }],
    stop_reason: stopReason, stop_sequence: null, stop_details: null,
    usage: { input_tokens: 1200, output_tokens: 300 }
  }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } });
};

const req = (body, origin = ORIGIN, method = "POST", path = "/judge") =>
  new Request(`https://kotalk-judge.example.workers.dev${path}`, {
    method, headers: { Origin: origin, "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined
  });

const sample = {
  theme: "週末の約束", partner: "지훈（会社の同僚）", level: "中級", voice: false,
  history: [{ who: "partner", ko: "이번 주말에 뭐 해요?" }],
  turn: { ko: "이번 주말에 뭐 해요?", ja: "今週末、何しますか？", hint_ko: "친구랑 영화 보러 가요.", hint_ja: "予定を言いましょう。", require: false, keywords: ["영화"] },
  reply: "쇼핑 하러 가요"
};

// 1) 許可していない Origin は拒否
assert.equal((await worker.fetch(req(sample, "https://evil.example"), env)).status, 403);
// 2) プリフライト
const pre = await worker.fetch(req(null, ORIGIN, "OPTIONS"), env);
assert.equal(pre.status, 204);
assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGIN);
// 3) 返事が空なら 400
assert.equal((await worker.fetch(req({ ...sample, reply: "  " }), env)).status, 400);
// 4) 正常系：送る内容と返す内容
const res = await worker.fetch(req(sample), env);
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), reply);
assert.match(sent.url, /\/v1\/messages/);
assert.equal(sent.body.model, "claude-haiku-5-5");
assert.equal(sent.body.fallbacks, undefined);
assert.equal(sent.body.output_config.effort, "low");
assert.equal(sent.body.output_config.format.type, "json_schema");
assert.equal(sent.body.thinking, undefined);
assert.match(sent.body.messages[0].content, /<learner_reply>\n쇼핑 하러 가요\n<\/learner_reply>/);
const beta = sent.headers instanceof Headers ? sent.headers.get("anthropic-beta") : null;
assert.equal(beta, null);
// 5) 断られたら 502
stopReason = "refusal";
assert.equal((await worker.fetch(req(sample), env)).status, 502);

console.log("worker check: OK");
