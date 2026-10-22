// Sends alerts: an in-app notification plus a phone push for everyone who holds the roles being alerted.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
const ROLES = ["directors", "jeff", "walter", "client", "screen1", "screen2", "screen3", "procurement", "storekeeper", "crew"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return reply(401, { error: "Please sign in again." });

  let body: any;
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request" }); }
  const roles: string[] = (Array.isArray(body.roles) ? body.roles : []).filter((r: string) => ROLES.includes(r));
  const title = String(body.title || "Hanamoto Workshop").slice(0, 80);
  const text = String(body.body || "").slice(0, 240);
  const job = body.job ? String(body.job) : null;
  const uids: string[] = (Array.isArray(body.uids) ? body.uids : []).map(String).slice(0, 20);
  if ((!roles.length && !uids.length) || !text) return reply(400, { error: "Nothing to send." });

  const { data: me } = await sb.from("profiles").select("id,role").eq("id", u.user.id).maybeSingle();
  if (!me) return reply(403, { error: "No role." });

  // who should hear about this (never the person who just did the action)
  const { data: profs } = await sb.from("profiles").select("id,role,jobs,is_owner");
  const targets = (profs || []).filter((p: any) =>
    (p.id !== me.id || body.self === true) &&
    (uids.includes(p.id) ||
      ((roles.includes(p.role) || (p.is_owner && roles.includes("directors"))) &&
        (p.role !== "client" || (job && (p.jobs || []).includes(job)))))
  );
  if (!targets.length) return reply(200, { sent: 0, note: "No one holds that position yet." });
  const ids = targets.map((p: any) => p.id);

  await sb.from("notifications").insert(ids.map((id: string) => ({ user_id: id, title, body: text, job })));

  // phone push
  const { data: sec } = await sb.from("app_secrets").select("key,value");
  const s = Object.fromEntries((sec || []).map((r: any) => [r.key, r.value]));
  let pushed = 0;
  if (s.vapid_public && s.vapid_private) {
    webpush.setVapidDetails(s.vapid_subject || "mailto:admin@example.com", s.vapid_public, s.vapid_private);
    const { data: subs } = await sb.from("push_subs").select("id,sub").in("user_id", ids);
    const payload = JSON.stringify({ title, body: text });
    await Promise.all((subs || []).map(async (r: any) => {
      try { await webpush.sendNotification(r.sub, payload); pushed++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subs").delete().eq("id", r.id); }
    }));
  }
  return reply(200, { sent: ids.length, pushed });
});
