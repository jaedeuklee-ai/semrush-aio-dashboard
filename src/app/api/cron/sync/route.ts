import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { getServerSupabase } from "@/lib/supabase";
import { fetchVisibility, fetchSentiment } from "@/lib/semrush";
import { BRANDS } from "@/config/brands";
import { isActiveIngestTag } from "@/config/ingest-scope";
import { getState, runChunk } from "@/lib/backfill";

// SEMrush sync into visibility_daily. Modes:
//
//   Single day (used by Vercel Cron, see vercel.json):
//     /api/cron/sync                         -> today (UTC)
//     /api/cron/sync?token=ADMIN_TOKEN&date=2026-06-13
//
//   Manual range (one call = up to `max` days, returns next):
//     /api/cron/sync?token=ADMIN_TOKEN&start=2026-01-01&end=2026-06-15&max=10
//
//   Auto backfill (self-chaining — start once, walks to the end on its own):
//     /api/cron/sync?token=ADMIN_TOKEN&start=2026-01-01&end=2026-06-16&chain=1
//     -> returns immediately; poll progress with ?status=1
//
//   Brand filter (any mode): restrict which brands are fetched this run.
//     ...&brands=ASUS,JBL,Sonos
//     Used to backfill only the new brands without re-fetching LG/Samsung.
//     Omitted -> all brands in BRANDS.ingest (the daily default).
//
// Whitelist filter (rev 25): SEMrush returns visibility rows for tags that are
// NOT in topic_whitelist (parent rollups it invents, retired tags, etc.). Those
// used to be upserted verbatim, polluting visibility_daily. Every sync now loads
// the topic_whitelist tag set once and drops any row whose tag isn't in it BEFORE
// upserting. We keep the FULL whitelist (leaf + rollup/Total tags), because the
// dashboard reads "X | Total" rollup rows — this is NOT the leaf-only filter the
// citations cron uses. Responses report `filtered` (rows dropped) per brand.
//
// Auth: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
// when CRON_SECRET is set. Manual calls use ?token=<ADMIN_TOKEN>.

export const dynamic = "force-dynamic";
// Vercel Hobby caps this at 60s; each chunk must finish within it.
export const maxDuration = 300; // Vercel Pro allows up to 300s

const JOB = "visibility";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// Resolve which brands to sync this run. `?brands=` is a comma list matched
// case-insensitively against BRANDS.ingest; unknown values are ignored.
// Returns the canonical casing from BRANDS.ingest. Empty/absent -> all.
function resolveBrands(raw: string | null): string[] {
  const all = [...BRANDS.ingest];
  if (!raw) return all;
  const want = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (want.length === 0) return all;
  return all.filter((b) => want.includes(b.toLowerCase()));
}

// Load the FULL set of whitelisted tags (leaf + rollup/Total) once per request.
// visibility_daily rows whose tag isn't here are dropped before upsert.
// Paginated because topic_whitelist can exceed Supabase's 1000-row cap.
async function loadWhitelistTags(sb: SupabaseClient): Promise<Set<string>> {
  const tags = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("topic_whitelist")
      .select("tag")
      .order("tag", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ tag: string }>) {
      if (isActiveIngestTag(r.tag)) tags.add(r.tag);
    }
    if (data.length < PAGE) break;
  }
  return tags;
}

async function syncOneDay(
  sb: SupabaseClient,
  date: string,
  brands: string[],
  whitelist: Set<string>,
  only?: string,                       // ★ 추가
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let filtered = 0;
  let npsFiltered = 0;
  for (const brand of brands) {
    // ---- visibility: only가 "nps"면 건너뜀 ----
    if (only !== "nps") {              // ★ 이 if로 visibility 블록 전체를 감쌈
      const rows = await fetchVisibility(brand, date);
      const kept = rows.filter((r) => whitelist.has(r.tag));
      filtered += rows.length - kept.length;
      const records = kept.map((r) => ({ date, brand, ...r }));
      for (let i = 0; i < records.length; i += 500) {
        const chunk = records.slice(i, i + 500);
        const { error } = await sb
          .from("visibility_daily")
          .upsert(chunk, { onConflict: "date,brand,tag" });
        if (error) throw error;
      }
      counts[brand] = kept.length;
    }                                  // ★ if 끝

    // ---- sentiment / NPS: 항상 실행 ----
    const sRows = await fetchSentiment(brand, date);
    const sKept = sRows.filter((r) => whitelist.has(r.tag));
    npsFiltered += sRows.length - sKept.length;
    const sRecords = sKept.map((r) => ({
      date, brand, tag: r.tag,
      positive: r.positive, negative: r.negative, neutral: r.neutral,
    }));
    for (let i = 0; i < sRecords.length; i += 500) {
      const chunk = sRecords.slice(i, i + 500);
      const { error } = await sb
        .from("nps_daily")
        .upsert(chunk, { onConflict: "date,brand,tag" });
      if (error) throw error;
    }
    counts[`${brand}_nps`] = sKept.length;
  }
  if (only !== "nps") counts.filtered = filtered;   // ★ visibility 안 돌면 생략
  counts.nps_filtered = npsFiltered;
  return counts;
}



export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const sb = getServerSupabase();
  const brands = resolveBrands(sp.get("brands"));

  if (brands.length === 0) {
    return NextResponse.json(
      { error: "no valid brands; check ?brands= against BRANDS.ingest" },
      { status: 400 },
    );
  }

  // ---------- Status check ----------
  if (sp.get("status") === "1") {
    const state = await getState(sb, JOB);
    return NextResponse.json({ ok: true, job: JOB, state });
  }

  // Load the whitelist tag set once for this request (all modes below use it).
  let whitelist: Set<string>;
  try {
    whitelist = await loadWhitelistTags(sb);
  } catch (e) {
    return NextResponse.json(
      { error: "failed to load topic_whitelist", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  if (whitelist.size === 0) {
    // Fail closed: with an empty whitelist every row would be dropped, which
    // would silently wipe the daily sync. Safer to abort loudly.
    return NextResponse.json(
      { error: "topic_whitelist is empty; aborting to avoid dropping all rows" },
      { status: 500 },
    );
  }

  // ---------- Auto backfill (self-chaining) ----------
  const start = sp.get("start");
  if (start && sp.get("chain") === "1") {
    const end = sp.get("end") ?? todayUTC();
    const max = Math.min(Math.max(Number(sp.get("max") ?? "2"), 1), 60);
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "start/end must be YYYY-MM-DD" }, { status: 400 });
    }
    if (start > end) {
      return NextResponse.json({ error: "start must be <= end" }, { status: 400 });
    }

    const token = sp.get("token");
    const brandsParam = sp.get("brands");
    const base = `${req.nextUrl.origin}${req.nextUrl.pathname}`;
    const nextUrlFor = (s: string) => {
      const u = new URL(base);
      u.searchParams.set("start", s);
      u.searchParams.set("end", end);
      u.searchParams.set("max", String(max));
      u.searchParams.set("chain", "1");
      if (token) u.searchParams.set("token", token);
      if (brandsParam) u.searchParams.set("brands", brandsParam);
      return u.toString();
    };

    const processDay = async (client: SupabaseClient, date: string): Promise<number> => {
      const counts = await syncOneDay(client, date, brands, whitelist);
      // Exclude the `filtered` bookkeeping key from the row total.
      return Object.entries(counts)
        .filter(([k]) => k !== "filtered")
        .reduce((a, [, v]) => a + v, 0);
    };

    // Run in the background and return immediately so the chain isn't blocked.
    waitUntil(runChunk({ sb, job: JOB, start, end, max, processDay, nextUrlFor }));
    return NextResponse.json({
      ok: true,
      accepted: true,
      job: JOB,
      from: start,
      to: end,
      brands,
      note: "Backfill started in the background. Poll progress with ?status=1.",
    });
  }

  // ---------- Manual range mode ----------
  if (start) {
    const end = sp.get("end") ?? todayUTC();
    const max = Math.min(Math.max(Number(sp.get("max") ?? "30"), 1), 60);

    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json({ error: "start/end must be YYYY-MM-DD" }, { status: 400 });
    }
    if (start > end) {
      return NextResponse.json({ error: "start must be <= end" }, { status: 400 });
    }

    const processed: Array<Record<string, string | number>> = [];
    let cursor = start;
    let doneThrough: string | null = null;

    try {
      for (let i = 0; i < max && cursor <= end; i++) {
        const counts = await syncOneDay(sb, cursor, brands, whitelist);
        processed.push({ date: cursor, ...counts });
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
      start,
      end,
      brands,
      days_done: processed.length,
      done_through: doneThrough,
      next: complete ? null : doneThrough ? nextDay(doneThrough) : start,
      complete,
      processed,
    });
  }

  // ---------- Explicit single-day mode (?date=YYYY-MM-DD) ----------
  const dateParam = sp.get("date");
  if (dateParam) {
    if (!DATE_RE.test(dateParam)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    try {
      const counts = await syncOneDay(sb, dateParam, brands, whitelist);
      return NextResponse.json({ ok: true, mode: "single", date: dateParam, ...counts });
    } catch (e) {
      return NextResponse.json(
        { ok: false, mode: "single", date: dateParam, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // ---------- Scheduled mode (no params — Vercel Cron) ----------
  // Re-fetch and overwrite the last LOOKBACK_DAYS days so late-arriving AI
  // data is filled in automatically. Upserts overwrite, so no duplicates.
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
  const processed: Array<Record<string, string | number>> = [];
  try {
    for (const d of dates) {
      const counts = await syncOneDay(sb, d, brands, whitelist);
      processed.push({ date: d, ...counts });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, mode: "scheduled", error: e instanceof Error ? e.message : String(e), processed },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, mode: "scheduled", lookback_days: LOOKBACK_DAYS, brands, processed });
}
