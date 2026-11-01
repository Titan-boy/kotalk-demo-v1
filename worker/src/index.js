// KoTalk の API（Cloudflare Worker）
//   POST /judge              会話の返事を Claude で判定する
//   POST /records/class      クラスコードの確認
//   POST /records/register   学習記録の登録・同意の変更
//   POST /records/reply      返事1回分の記録
//   POST /records/session    会話1回分の記録
//   POST /records/delete     本人による登録解除と記録の削除
//   GET  /export             教員用 CSV 書き出し（合言葉が必要）
// APIキーは Worker の secret（ANTHROPIC_API_KEY）にだけ置き、ブラウザには出さない。
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, RESULT_SCHEMA, SYSTEM_PROMPT, sanitize, buildUserMessage } from "./judge.js";
import { checkClass, register, saveReply, saveSession, deleteLearner, exportCsv, keyMatches } from "./records.js";

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

const json = (data, status, origin) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) }
  });

async function judge(input, env, origin) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured" }, 500, origin);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // 短い判定なので考える量は少なめにして、返事を速くする
      output_config: { effort: "low", format: { type: "json_schema", schema: RESULT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(input) }]
    });
    // 費用の確認用（`npx wrangler tail` で見られる）。返事の文は記録しない
    console.log(JSON.stringify({ model: response.model, input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }));
    // Haiku には自動のやり直し先がないので、断られたらブラウザ側の簡易判定に任せる
    if (response.stop_reason === "refusal") return json({ error: "refused" }, 502, origin);
    const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    return json(JSON.parse(text), 200, origin);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429, origin);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 500, origin);
    if (error instanceof Anthropic.APIConnectionTimeoutError) return json({ error: "timeout" }, 504, origin);
    if (error instanceof Anthropic.APIError) return json({ error: "upstream", status: error.status }, 502, origin);
    if (error instanceof SyntaxError) return json({ error: "bad_output" }, 502, origin);
    throw error;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 教員用の書き出しは、ブラウザで URL を開いて使う（Origin なし）。合言葉で守る
    if (request.method === "GET" && path === "/export") {
      if (!env.DB || !(await keyMatches(url.searchParams.get("key"), env.EXPORT_KEY))) {
        return new Response("Forbidden", { status: 403 });
      }
      const out = await exportCsv(env, url);
      if (!out) return new Response("Not found", { status: 404 });
      return new Response(out.csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${out.filename}"`,
          "Cache-Control": "no-store"
        }
      });
    }

    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ error: "not_found" }, 404, origin);

    // 大きすぎるリクエストは読まない
    const raw = await request.text();
    if (raw.length > 8000) return json({ error: "too_large" }, 413, origin);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "bad_request" }, 400, origin); }

    if (path === "/judge") {
      const input = sanitize(body);
      if (!input) return json({ error: "bad_request" }, 400, origin);
      return judge(input, env, origin);
    }

    if (path.startsWith("/records/")) {
      if (!env.DB) return json({ error: "records_disabled" }, 503, origin);
      let out;
      if (path === "/records/class") {
        const c = checkClass(env, body);
        out = { status: c.ok ? 200 : 404, data: c };
      }
      if (path === "/records/register") out = await register(env, body);
      if (path === "/records/reply") out = await saveReply(env, body);
      if (path === "/records/session") out = await saveSession(env, body);
      if (path === "/records/delete") out = await deleteLearner(env, body);
      if (out) return json(out.data, out.status, origin);
    }
    return json({ error: "not_found" }, 404, origin);
  }
};
