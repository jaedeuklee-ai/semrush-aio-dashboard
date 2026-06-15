import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { buildDemoVisibility, buildDemoWhitelist } from "../src/lib/demo";

// Local demo seed (terminal). For a no-terminal flow, use the admin route:
//   /api/admin/load?token=ADMIN_TOKEN&demo=1
async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const whitelist = buildDemoWhitelist();
  const wl = await sb.from("topic_whitelist").upsert(whitelist, { onConflict: "tag" });
  if (wl.error) throw wl.error;
  console.log(`Upserted ${whitelist.length} topics into topic_whitelist.`);

  const rows = buildDemoVisibility(14);
  const ins = await sb.from("visibility_daily").upsert(rows, { onConflict: "date,brand,tag" });
  if (ins.error) throw ins.error;
  console.log(`Upserted ${rows.length} rows into visibility_daily.`);
  console.log("Done. Start the app with `npm run dev`.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
