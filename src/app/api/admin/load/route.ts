import { NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase";
import { normalizeUrl } from "@/lib/url-normalize";
import { buildDemoVisibility, buildDemoWhitelist } from "@/lib/demo";

// One-time data loader you can trigger from a browser (no terminal):
//
//   Demo data:      /api/admin/load?token=ADMIN_TOKEN&demo=1
//   Load CSVs:      /api/admin/load?token=ADMIN_TOKEN            (reads data/*.csv from the repo)
//   Or POST CSV:    POST /api/admin/load?token=ADMIN_TOKEN
//                   body: { "owned_content": "<csv text>", "topic_whitelist": "<csv text>" }
//
// The POST path always works. The GET-from-disk path relies on the data/*.csv
// files being included in the deployment (see outputFileTracingIncludes in
// next.config.mjs); if it can't find them, use POST.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const token =
    req.nextUrl.searchParams.get("token") ?? req.headers.get("x-admin-token");
  return !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}

function parseCsv(text: string): Record<string, string>[] {
  const out = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return (out.data ?? []).filter((r) => Object.keys(r).length > 0);
}

async function upsertOwned(sb: SupabaseClient, text: string): Promise<number> {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const r of parseCsv(text)) {
    const raw = (r.url ?? "").trim();
    if (!raw) continue;
    const n = normalizeUrl(raw);
    if (!n || seen.has(n.normalized)) continue;
    seen.add(n.normalized);
    rows.push({ url_normalized: n.normalized, url: raw, domain: n.domain });
  }
  if (rows.length) {
    const { error } = await sb
      .from("owned_content")
      .upsert(rows, { onConflict: "url_normalized" });
    if (error) throw error;
  }
  return rows.length;
}

async function upsertTopics(sb: SupabaseClient, text: string): Promise<number> {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  parseCsv(text).forEach((r, i) => {
    const tag = (r.tag ?? "").trim();
    if (!tag || seen.has(tag)) return;
    seen.add(tag);
    rows.push({
      tag,
      label: (r.label ?? "").trim() || null,
      sort_order: r.sort_order ? Number(r.sort_order) : i,
    });
  });
  if (rows.length) {
    const { error } = await sb
      .from("topic_whitelist")
      .upsert(rows, { onConflict: "tag" });
    if (error) throw error;
  }
  return rows.length;
}

async function upsertPromptMap(sb: SupabaseClient, text: string): Promise<number> {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const r of parseCsv(text)) {
    const tag = (r.tag ?? "").trim();
    const prompt = (r.prompt ?? "").trim();
    if (!tag || !prompt) continue;
    const k = `${tag}\u0000${prompt}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ tag, prompt });
  }
  if (rows.length) {
    const { error } = await sb.from("prompt_map").upsert(rows, { onConflict: "tag,prompt" });
    if (error) throw error;
  }
  return rows.length;
}

function readData(file: string): string | null {
  const p = join(process.cwd(), "data", file);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

async function loadDemo(sb: SupabaseClient) {
  const wl = await sb
    .from("topic_whitelist")
    .upsert(buildDemoWhitelist(), { onConflict: "tag" });
  if (wl.error) throw wl.error;
  const rows = buildDemoVisibility(14);
  const vis = await sb
    .from("visibility_daily")
    .upsert(rows, { onConflict: "date,brand,tag" });
  if (vis.error) throw vis.error;
  return { topics: buildDemoWhitelist().length, visibility_rows: rows.length };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = getServerSupabase();
  try {
    if (req.nextUrl.searchParams.get("demo") === "1") {
      return NextResponse.json({ ok: true, demo: await loadDemo(sb) });
    }
    const owned = readData("owned_content.csv");
    const topics = readData("topic_whitelist.csv");
    const promptMap = readData("topic_prompt_map.csv");
    return NextResponse.json({
      ok: true,
      owned_content: owned != null ? await upsertOwned(sb, owned) : "file not found — use POST",
      topic_whitelist: topics != null ? await upsertTopics(sb, topics) : "file not found — use POST",
      prompt_map: promptMap != null ? await upsertPromptMap(sb, promptMap) : "file not found — use POST",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = getServerSupabase();
  try {
    const body = (await req.json().catch(() => ({}))) as {
      owned_content?: string;
      topic_whitelist?: string;
      prompt_map?: string;
    };
    const result: Record<string, number> = {};
    if (typeof body.owned_content === "string") {
      result.owned_content = await upsertOwned(sb, body.owned_content);
    }
    if (typeof body.topic_whitelist === "string") {
      result.topic_whitelist = await upsertTopics(sb, body.topic_whitelist);
    }
    if (typeof body.prompt_map === "string") {
      result.prompt_map = await upsertPromptMap(sb, body.prompt_map);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
