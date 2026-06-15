import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import { normalizeUrl } from "../src/lib/url-normalize";

function parseCsv(path: string): Record<string, string>[] {
  if (!existsSync(path)) {
    console.warn(`  (skip) ${path} not found`);
    return [];
  }
  const text = readFileSync(path, "utf8");
  const out = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return (out.data ?? []).filter((r) => Object.keys(r).length > 0);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ---- owned_content.csv (column: url) ----
  console.log("owned_content.csv");
  const ownedRows = parseCsv(resolve("data/owned_content.csv"));
  const seen = new Set<string>();
  const owned: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const r of ownedRows) {
    const raw = (r.url ?? "").trim();
    if (!raw) continue;
    const n = normalizeUrl(raw);
    if (!n) {
      skipped++;
      continue;
    }
    if (seen.has(n.normalized)) continue;
    seen.add(n.normalized);
    owned.push({ url_normalized: n.normalized, url: raw, domain: n.domain });
  }
  if (owned.length > 0) {
    const res = await sb.from("owned_content").upsert(owned, { onConflict: "url_normalized" });
    if (res.error) throw res.error;
  }
  console.log(`  upserted ${owned.length} URLs${skipped ? `, skipped ${skipped} unparseable` : ""}`);

  // ---- topic_whitelist.csv (columns: tag, [label], [sort_order]) ----
  console.log("topic_whitelist.csv");
  const tagRows = parseCsv(resolve("data/topic_whitelist.csv"));
  const tags: Record<string, unknown>[] = [];
  const seenTags = new Set<string>();
  tagRows.forEach((r, i) => {
    const tag = (r.tag ?? "").trim();
    if (!tag || seenTags.has(tag)) return;
    seenTags.add(tag);
    tags.push({
      tag,
      label: (r.label ?? "").trim() || null,
      sort_order: r.sort_order ? Number(r.sort_order) : i,
    });
  });
  if (tags.length > 0) {
    const res = await sb.from("topic_whitelist").upsert(tags, { onConflict: "tag" });
    if (res.error) throw res.error;
  }
  console.log(`  upserted ${tags.length} topics`);

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
