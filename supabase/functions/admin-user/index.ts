// Create, change, remove and reset people. Only directors (and Jeff, for floor roles) may call this.
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

const ALL_ROLES = ["directors", "jeff", "walter", "client", "screen1", "screen2", "screen3", "procurement", "storekeeper", "crew"];
const JEFF_MAY = ["walter", "client", "screen1", "screen2", "screen3", "crew"];
const WALTER_MAY = ["crew"];
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newPassword(): string {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}

async function caller(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: p } = await sb.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  return p;
}

function manageable(p: any): string[] {
  if (p.is_owner || p.role === "directors") return ALL_ROLES;
  if (p.role === "jeff") return JEFF_MAY;
  if (p.role === "walter") return WALTER_MAY;
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST" });

  const me = await caller(req);
  if (!me) return reply(401, { error: "Please sign in again." });
  const may = manageable(me);
  if (!may.length) return reply(403, { error: "You are not allowed to manage people." });

  let body: any;
  try { body = await req.json(); } catch { return reply(400, { error: "Bad request" }); }
  const { action } = body;

  try {
    if (action === "create") {
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const role = String(body.role || "");
      if (!name) return reply(400, { error: "Name is required." });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: "Enter a valid email address." });
      if (!ALL_ROLES.includes(role) || !may.includes(role)) return reply(403, { error: "You cannot create that role." });
      const password = newPassword();
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return reply(400, { error: error.message });
      const row = {
        id: data.user.id, name, email, role,
        title: String(body.title || "").trim(),
        boss: body.boss || null,
        jobs: Array.isArray(body.jobs) ? body.jobs.map(String) : [],
        must_change: true,
      };
      const { error: e2 } = await sb.from("profiles").insert(row);
      if (e2) { await sb.auth.admin.deleteUser(data.user.id); return reply(400, { error: e2.message }); }
      return reply(200, { id: data.user.id, email, password });
    }

    const { data: target } = await sb.from("profiles").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (!target) return reply(404, { error: "That person was not found." });
    if (target.id === me.id && action !== "reset") return reply(400, { error: "You cannot do that to your own account." });
    if (target.is_owner && !me.is_owner) return reply(403, { error: "The owner account is protected." });
    if (!may.includes(target.role) && !me.is_owner) return reply(403, { error: "You cannot manage this person." });

    if (action === "update") {
      const patch: Record<string, unknown> = {};
      if (typeof body.title === "string") patch.title = body.title.trim();
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
      if ("boss" in body) patch.boss = body.boss || null;
      if (Array.isArray(body.jobs)) patch.jobs = body.jobs.map(String);
      if (body.role) {
        if (!ALL_ROLES.includes(body.role) || !may.includes(body.role)) return reply(403, { error: "You cannot give that role." });
        patch.role = body.role;
      }
      const { error } = await sb.from("profiles").update(patch).eq("id", target.id);
      if (error) return reply(400, { error: error.message });
      return reply(200, { ok: true });
    }

    if (action === "delete") {
      const { error } = await sb.auth.admin.deleteUser(target.id);
      if (error) return reply(400, { error: error.message });
      return reply(200, { ok: true });
    }

    if (action === "reset") {
      const password = newPassword();
      const { error } = await sb.auth.admin.updateUserById(target.id, { password });
      if (error) return reply(400, { error: error.message });
      await sb.from("profiles").update({ must_change: true }).eq("id", target.id);
      return reply(200, { email: target.email, password });
    }

    return reply(400, { error: "Unknown action" });
  } catch (_e) {
    return reply(500, { error: "Something went wrong on the server." });
  }
});
