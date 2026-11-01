// KoTalk の会話判定 API（Cloudflare Worker）
// ブラウザ（GitHub Pages）→ この Worker → Claude API
// APIキーは Worker の secret（ANTHROPIC_API_KEY）にだけ置き、ブラウザには出さない。
import Anthropic from "@anthropic-ai/sdk";
import { MODEL, RESULT_SCHEMA, SYSTEM_PROMPT, sanitize, buildUserMessage } from "./judge.js";

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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403 });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || path !== "/judge") return json({ error: "not_found" }, 404, origin);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured" }, 500, origin);

    // 大きすぎるリクエストは読まない
    const raw = await request.text();
    if (raw.length > 8000) return json({ error: "too_large" }, 413, origin);
    let input;
    try { input = sanitize(JSON.parse(raw)); } catch { input = null; }
    if (!input) return json({ error: "bad_request" }, 400, origin);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 20_000 });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        // 短い判定なので考える量は少なめにして、返事を速くする
        output_config: { effort: "low", format: { type: "json_schema", schema: RESULT_SCHEMA } },
        // 安全分類で断られたときは、Anthropic 推奨のモデルで自動的にやり直す
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }]
      });
      if (response.stop_reason === "refusal") return json({ error: "refused" }, 502, origin);
      const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
      const result = JSON.parse(text);
      return json(result, 200, origin);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429, origin);
      if (error instanceof Anthropic.AuthenticationError) return json({ error: "bad_api_key" }, 500, origin);
      if (error instanceof Anthropic.APIConnectionTimeoutError) return json({ error: "timeout" }, 504, origin);
      if (error instanceof Anthropic.APIError) return json({ error: "upstream", status: error.status }, 502, origin);
      if (error instanceof SyntaxError) return json({ error: "bad_output" }, 502, origin);
      throw error;
    }
  }
};
