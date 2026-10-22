// Reads a drawing with Claude. The API key stays on the server (a Supabase secret named ANTHROPIC_API_KEY).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return reply(401, { error: "Please sign in again." });
  const { data: me } = await sb.from("profiles").select("role,is_owner").eq("id", u.user.id).maybeSingle();
  if (!me || !(me.is_owner || ["directors", "jeff"].includes(me.role))) {
    return reply(403, { error: "Only Jeff and the directors can use the estimator." });
  }
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return reply(503, { error: "The drawing reader is not switched on yet (no API key has been added)." });

  let body: any;
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request" }); }
  const { prompt, media } = body;
  if (!prompt || !media?.data) return reply(400, { error: "Missing drawing or prompt." });

  const isPdf = media.type === "application/pdf";
  const type = isPdf ? "application/pdf" : (["image/png", "image/gif", "image/webp"].includes(media.type) ? media.type : "image/jpeg");
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: type, data: media.data } }
    : { type: "image", source: { type: "base64", media_type: type, data: media.data } };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return reply(502, { error: out?.error?.message || "The drawing reader failed." });
  const text = (out.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  return reply(200, { text });
});
