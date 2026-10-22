// Connects the workshop app to Supabase (real logins, database, files) and Netlify (admin + drawing reader).
// It provides the same small "claude.use(...)" interface the app was built against.
(function () {
  const CFG = window.HW_CONFIG || {};
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  window.__sb = sb;

  let session = null, prof = null, resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const caches = {}, subs = {}, loading = {}, channels = {};
  const VIRTUAL = { roles: true, invites: true };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : String(Date.now()) + Math.random().toString(36).slice(2, 8));
  const el = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- screens: sign-in, change password, account ---------- */
  const css = `
  .hwo{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px;background:linear-gradient(135deg,#2a2627,#393536 60%,#ee2236 200%);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .hwc{background:#fff;color:#14181f;border-radius:22px;padding:24px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
  .hwc h2{margin:6px 0 4px;font-size:24px}.hwc p{margin:0 0 14px;color:#5d6675;font-size:15px}
  .hwc input{width:100%;font:inherit;padding:14px;border:1px solid #d6dbe6;border-radius:12px;margin-bottom:10px;box-sizing:border-box}
  .hwc button{width:100%;font:inherit;font-weight:700;font-size:18px;padding:14px;border:0;border-radius:12px;color:#fff;background:linear-gradient(135deg,#ee2236,#b81327);cursor:pointer;margin-top:4px}
  .hwc button.alt{background:#eef1f6;color:#14181f;font-weight:600;font-size:16px}
  .hwc .logo{width:52px;height:52px;border-radius:14px;background:#ee2236;display:grid;place-items:center;font-weight:800;font-size:20px;color:#fff}
  .hwc .err{color:#b00020;font-size:14px;min-height:18px;margin:2px 0 6px}
  .tv .hwacct{display:none}.hwbell em{position:absolute;top:-2px;right:-2px;background:#e5173f;color:#fff;font-style:normal;font-size:11px;font-weight:700;min-width:18px;border-radius:9px;padding:0 4px}.hwtoast{position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:120;background:#14181f;color:#fff;padding:12px 18px;border-radius:14px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,.4);font-family:system-ui,sans-serif}.hwacct{position:fixed;top:8px;right:8px;z-index:40;border:0;border-radius:999px;background:rgba(255,255,255,.2);color:#fff;font-size:20px;width:40px;height:40px;cursor:pointer;backdrop-filter:blur(6px)}
  `;
  document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css }));

  function overlay(inner) {
    const o = el(`<div class="hwo"><div class="hwc">${inner}</div></div>`);
    document.body.appendChild(o);
    return o;
  }

  function signInScreen(msg) {
    return new Promise((resolve) => {
      const o = overlay(`<img src="logo.png" alt="" style="height:56px;max-width:200px;object-fit:contain;display:none" onload="this.style.display='block';this.nextElementSibling.style.display='none'" onerror="this.remove()"><div class="logo">H</div><h2 style="letter-spacing:4px;font-weight:800">HANAMOTO</h2><p style="margin-top:-2px;font-size:12px;letter-spacing:2px;font-weight:700;color:#8a8486">ENTERPRISES LIMITED · WORKSHOP</p><p>Sign in with the email and password you were given.</p>
        <form><input type="email" name="e" placeholder="Email" autocomplete="username" required><input type="password" name="p" placeholder="Password" autocomplete="current-password" required>
        <div class="err">${esc(msg || "")}</div><button type="submit">Sign in</button></form>
        <p style="margin-top:14px;font-size:13px">Forgot your password? Ask a director or Jeff to reset it.</p>`);
      o.querySelector("form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target), btn = o.querySelector("button");
        btn.disabled = true; btn.textContent = "Signing in…";
        const { error } = await sb.auth.signInWithPassword({ email: String(f.get("e")).trim(), password: String(f.get("p")) });
        if (error) { o.querySelector(".err").textContent = "That email or password is not right."; btn.disabled = false; btn.textContent = "Sign in"; return; }
        o.remove(); resolve();
      });
    });
  }

  function changePasswordScreen(required) {
    return new Promise((resolve) => {
      const o = overlay(`<div class="logo">H</div><h2>${required ? "Choose your own password" : "Change password"}</h2><p>${required ? "You signed in with a temporary password. Please set one only you know." : "Type a new password."}</p>
        <form><input type="password" name="a" placeholder="New password (8+ characters)" autocomplete="new-password" minlength="8" required><input type="password" name="b" placeholder="Type it again" autocomplete="new-password" minlength="8" required>
        <div class="err"></div><button type="submit">Save password</button>${required ? "" : '<button type="button" class="alt" data-x>Cancel</button>'}</form>`);
      const x = o.querySelector("[data-x]"); if (x) x.onclick = () => { o.remove(); resolve(false); };
      o.querySelector("form").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target), a = String(f.get("a")), b = String(f.get("b"));
        if (a !== b) { o.querySelector(".err").textContent = "The two passwords do not match."; return; }
        const { error } = await sb.auth.updateUser({ password: a });
        if (error) { o.querySelector(".err").textContent = error.message; return; }
        await sb.rpc("clear_must_change");
        if (prof) prof.must_change = false;
        o.remove(); resolve(true);
      });
    });
  }

  function accountButton() {
    const b = Object.assign(document.createElement("button"), { className: "hwacct", textContent: "⚙", title: "Account" });
    b.onclick = () => {
      const o = overlay(`<h2>Account</h2><p>${esc(prof ? prof.name : "")}<br>${esc(session ? session.user.email : "")}</p>
        <p style="font-size:12px;color:#8a94a6;margin:0 0 10px">Version ${esc(window.HW_VERSION||"")}</p><p data-als style="font-size:14px;margin:0 0 8px"></p><button class="alt" data-al style="margin-bottom:8px">Turn on alerts on this phone</button><button class="alt" data-pw>Change password</button><button class="alt" data-so style="margin-top:8px">Sign out</button><button class="alt" data-x style="margin-top:8px">Close</button>`);
      o.querySelector("[data-x]").onclick = () => o.remove();
      const als = o.querySelector("[data-als]"), alb = o.querySelector("[data-al]");
      alertsState().then((st) => { als.textContent = st === "on" ? "Alerts are ON for this phone." : st === "blocked" ? "Alerts are blocked in your browser settings." : st === "unsupported" ? "This browser cannot receive phone alerts. On an iPhone, add the app to your Home Screen first." : "Alerts are off for this phone."; if (st === "on" || st === "unsupported") alb.style.display = "none"; });
      alb.onclick = async () => { als.textContent = "Turning on…"; try { await alertsOn(); als.textContent = "Alerts are ON for this phone."; alb.style.display = "none"; } catch (e) { als.textContent = e.message; } };
      o.querySelector("[data-pw]").onclick = async () => { o.remove(); await changePasswordScreen(false); };
      o.querySelector("[data-so]").onclick = async () => { await sb.auth.signOut(); location.reload(); };
    };
    document.body.appendChild(b);
  }

  /* ---------- alerts: phone push + in-app bell ---------- */
  const b64u = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  async function swReg() { if (!("serviceWorker" in navigator)) return null; try { return await navigator.serviceWorker.register("sw.js"); } catch (e) { return null; } }
  async function alertsState() {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return "unsupported";
    if (Notification.permission === "denied") return "blocked";
    const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && (await reg.pushManager.getSubscription());
    return sub && Notification.permission === "granted" ? "on" : "off";
  }
  async function alertsOn() {
    const reg = await swReg();
    if (!reg || !("PushManager" in window)) throw new Error("This browser cannot receive alerts. On an iPhone, add the app to your Home Screen first, then open it from there.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Alerts were not allowed. Allow notifications for this site in your browser settings, then try again.");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(CFG.VAPID_PUBLIC) });
    const j = sub.toJSON();
    const { error } = await sb.from("push_subs").upsert({ user_id: session.user.id, endpoint: j.endpoint, sub: j }, { onConflict: "endpoint" });
    if (error) throw error;
  }
  let notes = [];
  const seenKey = () => "hw-seen-" + (session ? session.user.id : "");
  const unread = () => { const t = Number(localStorage.getItem(seenKey()) || 0); return notes.filter((n) => new Date(n.created_at).getTime() > t).length; };
  function paintBell() { const b = document.querySelector(".hwbell"); if (!b) return; const n = unread(); b.innerHTML = "🔔" + (n ? `<em>${n > 9 ? "9+" : n}</em>` : ""); }
  function flash(msg) { const d = el(`<div class="hwtoast">${esc(msg)}</div>`); document.body.appendChild(d); setTimeout(() => d.remove(), 6000); }
  async function startAlerts() {
    const { data } = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
    notes = data || []; paintBell();
    sb.channel("notif-" + session.user.id).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + session.user.id }, (pl) => {
      notes.unshift(pl.new); paintBell(); flash(pl.new.body);
    }).subscribe();
  }
  function bellButton() {
    const b = Object.assign(document.createElement("button"), { className: "hwacct hwbell", title: "Alerts" });
    b.style.right = "54px"; b.innerHTML = "🔔";
    b.onclick = () => {
      localStorage.setItem(seenKey(), String(Date.now())); paintBell();
      const when = (t) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const o = overlay(`<h2>Alerts</h2><div style="max-height:55vh;overflow:auto">${notes.map((n) => `<p style="margin:0 0 12px"><b>${esc(n.body)}</b><br><span style="font-size:12px;color:#8a94a6">${when(n.created_at)}</span></p>`).join("") || "<p>Nothing yet. You will see alerts here when something needs you.</p>"}</div><button class="alt" data-x style="margin-top:8px">Close</button>`);
      o.querySelector("[data-x]").onclick = () => o.remove();
    };
    document.body.appendChild(b);
  }

  /* ---------- profile ---------- */
  async function loadProfile() {
    const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    return data;
  }

  /* ---------- document store ---------- */
  function cache(c) { return (caches[c] = caches[c] || new Map()); }
  const snap = (c) => ({ docs: [...cache(c).entries()].map(([id, data]) => ({ id, data: () => data })) });
  const fire = (c) => (subs[c] || new Set()).forEach((cb) => { try { cb(snap(c)); } catch (e) { console.error(e); } });

  const mapProfile = (p) => ({ role: p.role, title: p.title, jobs: p.jobs || [], boss: p.boss || "", name: p.name, email: p.email });

  async function load(c) {
    if (c === "invites") { cache(c); return; }
    if (c === "roles") {
      const { data, error } = await sb.from("profiles").select("*");
      if (error) throw error;
      const m = cache(c); m.clear(); (data || []).forEach((p) => m.set(p.id, mapProfile(p)));
      return;
    }
    const { data, error } = await sb.from("docs").select("id,data").eq("collection", c);
    if (error) throw error;
    const m = cache(c); m.clear(); (data || []).forEach((r) => m.set(r.id, r.data));
  }

  function watch(c) {
    if (channels[c] || c === "invites") return;
    if (c === "roles") {
      channels[c] = sb.channel("profiles-live").on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, async () => { await load("roles"); fire("roles"); }).subscribe();
      return;
    }
    channels[c] = sb.channel("docs-" + c).on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "collection=eq." + c }, (pl) => {
      const m = cache(c);
      if (pl.eventType === "DELETE") m.delete(pl.old.id); else m.set(pl.new.id, pl.new.data);
      fire(c);
    }).subscribe();
  }

  function collection(c) {
    return {
      onSnapshot(cb) {
        (subs[c] = subs[c] || new Set()).add(cb);
        (loading[c] = loading[c] || load(c).then(() => watch(c))).then(() => cb(snap(c))).catch((e) => { console.error(c, e); cb(snap(c)); });
        return () => subs[c].delete(cb);
      },
      async add(data) {
        if (VIRTUAL[c]) throw new Error("Use the Add a person form.");
        const id = uid();
        cache(c).set(id, data); fire(c);
        const { error } = await sb.from("docs").insert({ collection: c, id, data });
        if (error) { cache(c).delete(id); fire(c); throw error; }
        return { id };
      },
    };
  }

  function doc(path) {
    const i = path.indexOf("/"), c = path.slice(0, i), id = path.slice(i + 1);
    return {
      async update(patch) {
        if (c === "roles") return admin("update", Object.assign({ id }, patch));
        if (c === "invites") return;
        const m = cache(c), prev = m.get(id);
        if (prev) { m.set(id, Object.assign({}, prev, patch)); fire(c); }
        const { error } = await sb.rpc("doc_update", { p_collection: c, p_id: id, p_patch: patch });
        if (error) { if (prev) m.set(id, prev); else m.delete(id); fire(c); throw error; }
      },
      async set(data) {
        if (VIRTUAL[c]) throw new Error("Use the Add a person form.");
        const m = cache(c); m.set(id, data); fire(c);
        const { error } = await sb.from("docs").upsert({ collection: c, id, data, updated_at: new Date().toISOString() });
        if (error) { await load(c); fire(c); throw error; }
      },
      async delete() {
        if (c === "roles") return admin("delete", { id });
        if (c === "invites") return;
        const m = cache(c), prev = m.get(id);
        m.delete(id); fire(c);
        const { data, error } = await sb.from("docs").delete().eq("collection", c).eq("id", id).select("id");
        if (error || !data || !data.length) { if (prev) m.set(id, prev); fire(c); throw error || new Error("Not allowed to remove this."); }
      },
    };
  }

  /* ---------- server functions ---------- */
  async function authedFetch(path, body) {
    const { data } = await sb.auth.getSession();
    const r = await fetch(CFG.SUPABASE_URL + "/functions/v1/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + (data.session ? data.session.access_token : "") },
      body: JSON.stringify(body),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || "The server said no.");
    return out;
  }
  async function admin(action, payload) {
    const out = await authedFetch("admin-user", Object.assign({ action }, payload));
    if (action !== "create" && action !== "reset") { await load("roles"); fire("roles"); }
    else if (action === "create") { await load("roles"); fire("roles"); }
    return out;
  }

  /* ---------- drawing reader (sample) ---------- */
  function toBase64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  }
  async function shrink(blob) {
    if (!/^image\//.test(blob.type) || blob.size < 1.5e6) return blob;
    const url = URL.createObjectURL(blob), img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const k = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return await new Promise((res) => c.toBlob((b) => res(b || blob), "image/jpeg", 0.88));
  }
  const sample = async () => { throw new Error("Use sample.json"); };
  sample.limits = async () => ({ images: true });
  sample.json = async (prompt, opts) => {
    let f = opts && opts.images; if (Array.isArray(f)) f = f[0];
    if (!f) throw new Error("No drawing supplied.");
    f = await shrink(f);
    if (f.size > 4.2e6) throw new Error("That file is too large. Use a smaller image or a PDF under 4 MB.");
    const out = await authedFetch("estimate", { prompt, media: { type: f.type, data: await toBase64(f) } });
    const t = String(out.text || "").replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    return JSON.parse(a >= 0 ? t.slice(a, b + 1) : t);
  };

  /* ---------- capabilities ---------- */
  const caps = {
    db: { collection, doc },
    user: {
      id: async () => session.user.id,
      isOwner: async () => !!(prof && prof.is_owner),
      canEdit: async () => !!(prof && (prof.is_owner || ["directors", "jeff"].includes(prof.role))),
      can: async () => true,
      me: async () => ({ id: session.user.id, name: prof ? prof.name : "", email: session.user.email }),
      profiles: async (ids) => {
        const out = {}; (ids || []).forEach((id) => { const p = cache("roles").get(id); out[id] = { id, name: p ? p.name : "" }; }); return out;
      },
      search: async () => [],
    },
    assets: {
      upload: async (blob) => {
        const safe = (blob.name || "file").replace(/[^\w.\-]+/g, "_").slice(-60), path = uid() + "-" + safe;
        const { error } = await sb.storage.from("files").upload(path, blob, { contentType: blob.type || "application/octet-stream" });
        if (error) throw error;
        return { id: path, url: sb.storage.from("files").getPublicUrl(path).data.publicUrl, sizeBytes: blob.size, contentType: blob.type };
      },
    },
    downloads: {
      save: async ({ filename, data }) => {
        const b = data instanceof Blob ? data : new Blob([data], { type: "application/octet-stream" });
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: filename });
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      },
    },
    sample,
    admin: { call: admin, notify: async (p) => { try { await authedFetch("notify", p); } catch (e) { console.warn("alert not sent", e); } } },
  };

  window.claude = { use: async (name) => { await ready; return caps[name] || null; } };

  /* ---------- start ---------- */
  (async function boot() {
    const cur = await sb.auth.getSession();
    session = cur.data.session;
    if (!session) { await signInScreen(); session = (await sb.auth.getSession()).data.session; }
    prof = await loadProfile();
    if (!prof) {
      overlay(`<h2>Almost there</h2><p>You are signed in, but you have not been given a role yet. Ask a director or Jeff to add you.</p><button class="alt" onclick="window.__sb.auth.signOut().then(()=>location.reload())">Sign out</button>`);
      return;
    }
    if (prof.must_change) await changePasswordScreen(true);
    sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") location.reload(); });
    accountButton(); bellButton(); startAlerts().catch(() => {}); swReg();
    resolveReady();
  })();
})();
