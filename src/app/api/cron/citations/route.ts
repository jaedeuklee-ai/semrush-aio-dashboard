import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { getServerSupabase } from "@/lib/supabase";
import { fetchRawCitations } from "@/lib/semrush";
import { normalizeUrl } from "@/lib/url-normalize";
import { isActiveIngestTag } from "@/config/ingest-scope";
import { getState, runChunk } from "@/lib/backfill";

// Fills prompt_citations_daily (prompt-grain citation events) and derives
// topic_citations from it via the rebuild_topic_citations RPC.
//
// ENGINE (2026-07-03 rev 6): instead of one SEMrush call PER LEAF TAG
// (~103 calls/day, element 553cd819), we call the raw prompt-grain element
// (404fb017) once PER PARENT BATCH (e.g. tv__non-brand / it__non-brand /
// audio__non-brand -> 3 calls/day). Every response row carries its full tag
// hierarchy in `tags`, so rows are fanned out to their whitelist LEAF tag
// client-side (leaves are MECE -> exactly one leaf per row). Verified: the
// element returns ALL rows in one response (no pagination), and no
// comparison window is sent.
//
// Pipeline per day:
//   1. fetchRawCitations(parent, date) for each parent batch (parallel)
//   2. fan-out rows to leaf tags, normalize URLs, dedupe by PK
//   3. upsert into prompt_citations_daily (chunks of 500)
//   4. rpc rebuild_topic_citations(date, date) -> topic_citations
//      (mentions = COUNT(*), position = AVG(position); runs in Postgres)
//
//   Single day:   /api/cron/citations?token=ADMIN_TOKEN&date=2026-06-01
//   Manual range: /api/cron/citations?token=ADMIN_TOKEN&start=2026-01-01&end=2026-06-15&max=2
//   Auto backfill:/api/cron/citations?token=ADMIN_TOKEN&start=2026-01-01&end=2026-06-16&chain=1
//                 (returns immediately; poll with ?status=1)
//
//   Scope filters (any mode) — restrict which topics are ingested this run:
//     &group=tv          -> only tags starting with "tv" (prefix match; startsWith)
//     &group=tv,audio    -> tags starting with "tv" OR "audio"
//     &tags=a,b,c        -> only these exact tags (matched against whitelist)
//   Both can combine (group first, then narrowed to the tags list). None -> all.
//   Parent batches are DERIVED from the scoped leaf set (first two "__"
//   segments), so &group=tv results in a single tv__non-brand call, and
//   &tags=<one leaf> still makes one parent call but only that leaf's rows
//   are kept by the fan-out filter.
//
//   LEAF-ONLY (always applied, before scope filters): rollup/parent tags are
//   excluded from the leaf set. A tag is a "parent" if another whitelist tag
//   starts with it + "__". prompt_citations_daily stores LEAF tags only, same
//   contract as topic_citations.
//
// RATE LIMIT NOTE: this engine uses ~3 SEMrush calls per day ingested
// (1 per parent batch) instead of ~103 — the hourly cap (~100/hr shared)
// is no longer a constraint for daily syncs, and multi-month backfills
// become feasible (30 days ≈ 90 calls ≈ 1 hour of budget).
//
// Scheduled mode OVERWRITES the last LOOKBACK_DAYS unconditionally (no skip),
// so partially-filled days self-heal on the next run.
//
// RETENTION: scheduled mode also deletes both citation tables rows
// older than RETENTION_DAYS after the daily ingest — see the constant below.

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro allows up to 300s

const JOB = "citations";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Both prompt-level raw rows and topic-level aggregate rows are retained for
// 90 days. Pruning runs in SCHEDULED MODE ONLY after ingestion and rebuild.
// Manual/range/chain backfills do not prune rows in the same request; any
// older backfilled rows are subject to pruning on the next scheduled run.
// NOTE: DELETE marks rows dead; autovacuum recycles the space for reuse. To
// shrink the file on disk after the first big cleanup, run VACUUM FULL once
// manually (locks the table while it runs — do it off-hours).
const RETENTION_DAYS = 90;

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  const token = req.nextUrl.searchParams.get("token");
  if (process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN) return true;
  return false;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function prevDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function daysAgoUTC(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Delete old rows from BOTH citation tables. Run only after scheduled rebuild.
// A failure is reported per table; the other table is still attempted.
async function pruneOldCitationRows(sb: SupabaseClient): Promise<{
  cutoff: string;
  tables: Record<string, { deleted: number } | { error: string }>;
}> {
  const cutoff = daysAgoUTC(RETENTION_DAYS);
  const tables: Record<string, { deleted: number } | { error: string }> = {};
  for (const table of ["prompt_citations_daily", "topic_citations"] as const) {
    try {
      const { error, count } = await sb
        .from(table)
        .delete({ count: "exact" })
        .lt("date", cutoff);
      if (error) throw error;
      tables[table] = { deleted: count ?? 0 };
    } catch (e) {
      tables[table] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { cutoff, tables };
}

async function getTags(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from("topic_whitelist").select("tag");
  if (error) throw error;
  return (data ?? []).map((r) => r.tag as string);
}

// Keep only leaf tags: drop any tag that is a prefix (parent) of another tag,
// i.e. some other tag starts with `tag + "__"`. Parent tags are sub-topic
// rollups/totals. Uses "__" as the separator so a tag isn't mistaken for a
// parent of an unrelated tag that merely shares a leading substring.
function leafTagsOnly(all: string[]): string[] {
  return all.filter(
    (t) => !all.some((other) => other !== t && other.startsWith(t + "__")),
  );
}

// Narrow the (already leaf-filtered) whitelist by optional scope filters:
//   group: comma-separated prefixes; keep tags that startsWith ANY of them.
//   tags:  comma-separated exact tag names; keep only those.
// Applied in order (group, then tags). Both absent/empty -> all leaf tags.
function resolveScope(
  all: string[],
  group: string | null,
  tags: string | null,
): string[] {
  let out = all;

  if (group) {
    const prefixes = group
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (prefixes.length > 0) {
      out = out.filter((t) => prefixes.some((p) => t.startsWith(p)));
    }
  }

  if (tags) {
    const want = new Set(
      tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    if (want.size > 0) {
      out = out.filter((t) => want.has(t));
    }
  }

  return out;
}

// Derive the SEMrush parent batches from the scoped leaf set: the first two
// "__" segments of each leaf (e.g. "it__non-brand__Monitor Refresh rate__..."
// -> "it__non-brand"). The whitelist's non-brand categories are exactly
// tv/it/audio today, but deriving (instead of hardcoding) keeps a future
// category covered automatically.
function parentBatchesOf(leafTags: string[]): string[] {
  const set = new Set<string>();
  for (const t of leafTags) {
    const segs = t.split("__");
    set.add(segs.length >= 2 ? segs.slice(0, 2).join("__") : t);
  }
  return [...set];
}

interface DailyRecord {
  date: string;
  tag: string;
  source_url: string;
  model: string;
  prompt: string;
  position: number | null;
  domain_type: string | null;
  domain: string | null;
  url_normalized: string | null;
}

// normalizeUrl returns { normalized, domain } (src/lib/url-normalize.ts —
// the single source of truth for URL matching).
function normalizedParts(source: string): { domain: string | null; url_normalized: string | null } {
  const n = normalizeUrl(source);
  return { domain: n?.domain ?? null, url_normalized: n?.normalized ?? null };
}

// Fetch + fan-out + upsert ONE parent batch on a date. Returns rows written.
// Throws on failure so the caller (Promise.allSettled) can record it.
async function citationsForParent(
  sb: SupabaseClient,
  parent: string,
  leafSet: Set<string>,
  date: string,
): Promise<number> {
  const rows = await fetchRawCitations(parent, date);

  // Dedupe by PK in-memory: upserting the same key twice in ONE statement is
  // a Postgres error ("cannot affect row a second time"). Last row wins.
  const byKey = new Map<string, DailyRecord>();
  for (const r of rows) {
    if (!r.source || !r.model || !r.prompt) continue;
    // Fan-out: pick the whitelist LEAF this row belongs to. Leaves are MECE,
    // so at most one matches; rows outside the whitelist are dropped.
    const leaf = r.tags
      .split(",")
      .map((s) => s.trim())
      .find((t) => leafSet.has(t));
    if (!leaf) continue;

    const { domain, url_normalized } = normalizedParts(r.source);
    const key = [date, leaf, r.source, r.model, r.prompt].join("\u0001");
    byKey.set(key, {
      date,
      tag: leaf,
      source_url: r.source,
      model: r.model,
      prompt: r.prompt,
      position: r.position,
      domain_type: r.domain_type,
      domain,
      url_normalized,
    });
  }

  const records = [...byKey.values()];
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const { error } = await sb
      .from("prompt_citations_daily")
      .upsert(chunk, { onConflict: "date,tag,source_url,model,prompt" });
    if (error) throw error;
  }
  return records.length;
}

export interface DayResult {
  rows: number;
  failed: string[]; // parent batches that errored (skipped, not fatal)
  rebuilt: number; // (date, tag, source_url) groups upserted into topic_citations
}

// Process all parent batches for one date in parallel, then re-aggregate that
// date into topic_citations via the RPC. A parent that throws (e.g. SEMrush
// 429) is recorded in `failed` and skipped; the rest of the day still
// completes and the rebuild still runs on whatever landed.
async function citationsForDay(
  sb: SupabaseClient,
  parents: string[],
  leafSet: Set<string>,
  date: string,
): Promise<DayResult> {
  let inserted = 0;
  const failed: string[] = [];

  const results = await Promise.allSettled(
    parents.map((p) => citationsForParent(sb, p, leafSet, date)),
  );
  results.forEach((res, idx) => {
    if (res.status === "fulfilled") {
      inserted += res.value;
    } else {
      failed.push(parents[idx]);
    }
  });

  // Derive topic_citations for this date (runs entirely in Postgres).
  const { data: rebuilt, error } = await sb.rpc("rebuild_topic_citations", {
    p_start: date,
    p_end: date,
  });
  if (error) throw new Error(`rebuild_topic_citations failed: ${JSON.stringify(error)}`);

  return { rows: inserted, failed, rebuilt: typeof rebuilt === "number" ? rebuilt : 0 };
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const sb = getServerSupabase();

  // ---------- Status check ----------
  if (sp.get("status") === "1") {
    const state = await getState(sb, JOB);
    return NextResponse.json({ ok: true, job: JOB, state });
  }

  let allTags: string[];
  try {
    allTags = await getTags(sb);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  if (allTags.length === 0) {
    return NextResponse.json(
      { ok: false, error: "topic_whitelist is empty — load it first (/api/admin/load)." },
      { status: 400 },
    );
  }

  // Always drop rollup/parent tags first, then apply optional ?group=/?tags=.
  const leafTags = leafTagsOnly(allTags).filter(isActiveIngestTag);
  const tags = resolveScope(leafTags, sp.get("group"), sp.get("tags"));
  if (tags.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no tags matched; check ?group=/?tags= against topic_whitelist (parent/rollup tags are excluded)",
      },
      { status: 400 },
    );
  }
  const leafSet = new Set(tags);
  const parents = parentBatchesOf(tags);

  // runChunk expects processDay -> Promise<number>; return the row count and
  // let per-parent failures be swallowed (recorded in DayResult.failed) so the
  // backfill chain keeps moving instead of aborting on one bad batch.
  const processDay = (client: SupabaseClient, date: string) =>
    citationsForDay(client, parents, leafSet, date).then((r) => r.rows);

  // ---------- Auto backfill (self-chaining) ----------
  const start = sp.get("start");
  if (start && sp.get("chain") === "1") {
    const end = sp.get("end") ?? todayUTC();
    const max = Math.min(Math.max(Number(sp.get("max") ?? "1"), 1), 60);
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "start/end must be YYYY-MM-DD" }, { status: 400 });
    }
    if (start > end) {
      return NextResponse.json({ error: "start must be <= end" }, { status: 400 });
    }

    const token = sp.get("token");
    const groupParam = sp.get("group");
    const tagsParam = sp.get("tags");
    const base = `${req.nextUrl.origin}${req.nextUrl.pathname}`;
    const nextUrlFor = (s: string) => {
      const u = new URL(base);
      u.searchParams.set("start", s);
      u.searchParams.set("end", end);
      u.searchParams.set("max", String(max));
      u.searchParams.set("chain", "1");
      if (token) u.searchParams.set("token", token);
      if (groupParam) u.searchParams.set("group", groupParam);
      if (tagsParam) u.searchParams.set("tags", tagsParam);
      return u.toString();
    };

    waitUntil(runChunk({ sb, job: JOB, start, end, max, processDay, nextUrlFor }));
    return NextResponse.json({
      ok: true,
      accepted: true,
      job: JOB,
      topics: tags.length,
      batches: parents,
      from: start,
      to: end,
      note: "Backfill started in the background. Poll progress with ?status=1.",
    });
  }

  // ---------- Manual range mode ----------
  if (start) {
    const end = sp.get("end") ?? todayUTC();
    const max = Math.min(Math.max(Number(sp.get("max") ?? "10"), 1), 60);
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "start/end must be YYYY-MM-DD" }, { status: 400 });
    }
    if (start > end) {
      return NextResponse.json({ error: "start must be <= end" }, { status: 400 });
    }

    const processed: Array<{ date: string; rows: number; rebuilt: number; failed: string[] }> = [];
    let cursor = start;
    let doneThrough: string | null = null;
    try {
      for (let i = 0; i < max && cursor <= end; i++) {
        const { rows, failed, rebuilt } = await citationsForDay(sb, parents, leafSet, cursor);
        processed.push({ date: cursor, rows, rebuilt, failed });
        doneThrough = cursor;
        cursor = nextDay(cursor);
      }
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          mode: "range",
          error: e instanceof Error ? e.message : String(e),
          done_through: doneThrough,
          next: doneThrough ? nextDay(doneThrough) : start,
          processed,
        },
        { status: 500 },
      );
    }

    const complete = doneThrough !== null && doneThrough >= end;
    return NextResponse.json({
      ok: true,
      mode: "range",
      topics: tags.length,
      batches: parents,
      start,
      end,
      days_done: processed.length,
      done_through: doneThrough,
      next: complete ? null : doneThrough ? nextDay(doneThrough) : start,
      complete,
      processed,
    });
  }

  // ---------- Explicit single day (?date=YYYY-MM-DD) ----------
  const dateParam = sp.get("date");
  if (dateParam) {
    if (!DATE_RE.test(dateParam)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    try {
      const { rows, failed, rebuilt } = await citationsForDay(sb, parents, leafSet, dateParam);
      return NextResponse.json({
        ok: true,
        mode: "single",
        date: dateParam,
        topics: tags.length,
        batches: parents,
        rows,
        rebuilt,
        failed,
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, mode: "single", date: dateParam, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // ---------- Scheduled mode (no params — Vercel Cron) ----------
  // Overwrite the last LOOKBACK_DAYS unconditionally. Upserts overwrite, so no
  // duplicates, and partially-filled days (a parent batch missing due to an
  // earlier rate-limit/error) self-heal on the next run. Cost: LOOKBACK_DAYS
  // x parents.length SEMrush calls (5 x 3 = 15) — well inside the hourly cap.
  const LOOKBACK_DAYS = 5;
  const today = todayUTC();
  const dates: string[] = [];
  {
    let d = today;
    for (let i = 0; i < LOOKBACK_DAYS; i++) {
      dates.push(d);
      d = prevDay(d);
    }
  }
  const processed: Array<Record<string, string | number | string[]>> = [];
  try {
    for (const d of dates) {
      const { rows, failed, rebuilt } = await citationsForDay(sb, parents, leafSet, d);
      processed.push({ date: d, rows, rebuilt, failed });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, mode: "scheduled", error: e instanceof Error ? e.message : String(e), processed },
      { status: 500 },
    );
  }

  // Prune both raw and aggregate citation rows after scheduled ingestion.
  // Keep the cron successful even if retention fails; expose per-table errors.
  const retention = await pruneOldCitationRows(sb);

  return NextResponse.json({
    ok: true,
    mode: "scheduled",
    lookback_days: LOOKBACK_DAYS,
    topics: tags.length,
    batches: parents,
    processed,
    retention,
  });
}
