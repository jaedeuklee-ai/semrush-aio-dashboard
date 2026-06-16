import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase";
import {
  fetchPromptBrands,
  fetchPromptCitations,
  fetchPromptFanout,
} from "@/lib/semrush";
import { BRANDS } from "@/config/brands";

// Fills the prompt-level tables from the user-provided prompt_map.
// For each (tag, prompt) it calls 3 SEMrush elements (brands, citations,
// fan-out) → 3 calls per prompt, so keep `max` small (rate limit 100/hr).
//
//   One prompt (test):  /api/cron/prompts?token=ADMIN_TOKEN&tag=...&prompt=...
//   Chunk:              /api/cron/prompts?token=ADMIN_TOKEN&offset=0&max=5
//     → processes `max` rows of prompt_map from `offset`, returns next offset.
//       Re-call with offset=<next> until done=true. Upserts are idempotent.
//   Status:             /api/cron/prompts?token=ADMIN_TOKEN&status=1
//
// start/end default to the last 30 days.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const token = req.nextUrl.searchParams.get("token");
  const admin = process.env.ADMIN_TOKEN;
  if (admin && token === admin) return true;
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth === `Bearer ${secret}`) return true;
  return false;
}

function defaultRange(sp: URLSearchParams): { start: string; end: string } {
  const end = sp.get("end") ?? new Date().toISOString().slice(0, 10);
  let start = sp.get("start");
  if (!start) {
    const d = new Date(end + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 29);
    start = d.toISOString().slice(0, 10);
  }
  return { start, end };
}

async function processPrompt(
  sb: SupabaseClient,
  tag: string,
  prompt: string,
  start: string,
  end: string,
): Promise<{ brands: number; citations: number; fanout: number }> {
  const brandRows = await fetchPromptBrands(tag, prompt, start, end);
  const brandSet = new Set<string>();
  const models = new Set<string>();
  let volume = 0;
  for (const r of brandRows) {
    r.brands_list.forEach((b) => brandSet.add(b));
    if (r.model) models.add(r.model);
    if (r.volume != null) volume = Math.max(volume, r.volume);
  }
  const lower = [...brandSet].map((b) => b.toLowerCase());
  const lg_present = lower.includes(BRANDS.own.toLowerCase());
  const samsung_present = lower.includes(BRANDS.competitor.toLowerCase());
  await sb.from("prompt_brands").upsert(
    {
      tag,
      prompt,
      brands_list: [...brandSet],
      brands_amount: brandSet.size,
      volume,
      lg_present,
      samsung_present,
      models: [...models],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tag,prompt" },
  );

  const citeRows = await fetchPromptCitations(tag, prompt, start, end);
  if (citeRows.length > 0) {
    await sb.from("prompt_citations").upsert(
      citeRows
        .filter((c) => c.source_url)
        .map((c) => ({
          tag,
          prompt,
          source_url: c.source_url,
          source_title: c.source_title,
          citations: c.citations,
          latest_date: c.latest_date,
          updated_at: new Date().toISOString(),
        })),
      { onConflict: "tag,prompt,source_url" },
    );
  }

  const fanRows = await fetchPromptFanout(tag, prompt, start, end);
  if (fanRows.length > 0) {
    await sb.from("prompt_fanout").upsert(
      fanRows
        .filter((f) => f.query)
        .map((f) => ({
          tag,
          prompt,
          query: f.query,
          count: f.count,
          updated_at: new Date().toISOString(),
        })),
      { onConflict: "tag,prompt,query" },
    );
  }

  return { brands: brandSet.size, citations: citeRows.length, fanout: fanRows.length };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const sb = getServerSupabase();

  if (sp.get("status") === "1") {
    const map = await sb.from("prompt_map").select("*", { count: "exact", head: true });
    const pb = await sb.from("prompt_brands").select("*", { count: "exact", head: true });
    return NextResponse.json({
      ok: true,
      prompt_map_rows: map.count ?? 0,
      prompt_brands_rows: pb.count ?? 0,
    });
  }

  const { start, end } = defaultRange(sp);

  const tag = sp.get("tag");
  const prompt = sp.get("prompt");
  if (tag && prompt) {
    try {
      const r = await processPrompt(sb, tag, prompt, start, end);
      return NextResponse.json({ ok: true, tag, prompt, range: { start, end }, ...r });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  const offset = Math.max(Number(sp.get("offset") ?? "0"), 0);
  const max = Math.min(Math.max(Number(sp.get("max") ?? "5"), 1), 30);

  const { data, error, count } = await sb
    .from("prompt_map")
    .select("tag,prompt", { count: "exact" })
    .order("tag", { ascending: true })
    .order("prompt", { ascending: true })
    .range(offset, offset + max - 1);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      done: true,
      message:
        count === 0
          ? "prompt_map is empty — load topic_prompt_map.csv first."
          : "nothing left to process",
      total: count ?? 0,
    });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    try {
      const out = await processPrompt(sb, r.tag as string, r.prompt as string, start, end);
      results.push({ tag: r.tag, prompt: r.prompt, ...out });
    } catch (e) {
      results.push({ tag: r.tag, prompt: r.prompt, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const next = offset + rows.length;
  const done = count != null ? next >= count : rows.length < max;
  return NextResponse.json({
    ok: true,
    range: { start, end },
    processed: rows.length,
    offset,
    next: done ? null : next,
    done,
    total: count ?? null,
    results,
  });
}
