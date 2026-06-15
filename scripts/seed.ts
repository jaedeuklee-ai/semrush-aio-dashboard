import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { BRANDS } from "../src/config/brands";

// Demo topics — chosen to be mutually exclusive (no parent/child overlap) so
// the Total widget stays correct. Values mirror the real sample shape: LG
// leads on TV, trails on IT (monitors) and Audio.
const TOPICS = [
  { tag: "tv__non-brand", label: "TV", lg: 0.88, samsung: 0.8, prompts: 2788 },
  { tag: "it__non-brand", label: "IT / Monitors", lg: 0.586, samsung: 0.72, prompts: 1580 },
  { tag: "audio__non-brand", label: "Audio", lg: 0.15, samsung: 0.55, prompts: 500 },
];

const DAYS = 14;

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Deterministic-ish jitter so the demo looks like real (non-deterministic) AI data.
function jitter(base: number, dayIndex: number, salt: number): number {
  const wobble = Math.sin(dayIndex * 1.3 + salt) * 0.05;
  return Math.min(1, Math.max(0, base + wobble));
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1) whitelist
  const whitelist = TOPICS.map((t, i) => ({ tag: t.tag, label: t.label, sort_order: i }));
  const wl = await sb.from("topic_whitelist").upsert(whitelist, { onConflict: "tag" });
  if (wl.error) throw wl.error;
  console.log(`Upserted ${whitelist.length} topics into topic_whitelist.`);

  // 2) daily visibility for both brands
  const rows: Record<string, unknown>[] = [];
  for (let d = DAYS - 1; d >= 0; d--) {
    const date = isoDaysAgo(d);
    TOPICS.forEach((t, ti) => {
      for (const [brand, base, salt] of [
        [BRANDS.own, t.lg, ti],
        [BRANDS.competitor, t.samsung, ti + 10],
      ] as const) {
        const visibility = Number(jitter(base, d, salt).toFixed(4));
        const prompts = t.prompts;
        const prompts_mentioned = Math.round(visibility * prompts);
        rows.push({
          date,
          brand,
          tag: t.tag,
          visibility,
          sov: Number((visibility * 0.7).toFixed(4)),
          avg_position: Number((1 + (1 - visibility) * 4).toFixed(2)),
          mentions: Math.round(prompts_mentioned * 1.5),
          prompts,
          prompts_mentioned,
          unique_prompts: Math.round(prompts / 4),
        });
      }
    });
  }

  const ins = await sb.from("visibility_daily").upsert(rows, { onConflict: "date,brand,tag" });
  if (ins.error) throw ins.error;
  console.log(`Upserted ${rows.length} rows into visibility_daily (${DAYS} days × ${TOPICS.length} topics × 2 brands).`);
  console.log("Done. Start the app with `npm run dev`.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
