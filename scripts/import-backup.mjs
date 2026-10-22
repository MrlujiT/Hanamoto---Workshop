// Optional: move the data from the Claude prototype into the new database.
// 1. In the prototype, People tab > "Back up all data" saves a .json file.
// 2. Run:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-backup.mjs path/to/backup.json
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [file] = process.argv.slice(2);
if (!file) { console.error("Usage: node scripts/import-backup.mjs backup.json"); process.exit(1); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const backup = JSON.parse(readFileSync(file, "utf8"));

for (const c of ["jobs", "items", "batches", "files", "crew", "rules"]) {
  const rows = (backup[c] || []).map(({ id, ...data }) => ({ collection: c, id, data }));
  if (!rows.length) continue;
  const { error } = await sb.from("docs").upsert(rows);
  console.log(c, error ? "FAILED: " + error.message : rows.length + " imported");
}
