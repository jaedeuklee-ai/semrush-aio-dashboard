import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase";
import { fetchVisibility } from "@/lib/semrush";
import { BRANDS } from "@/config/brands";

// SEMrush sync into visibility_daily. Two modes:
//
//   Single day (used by Vercel Cron, see vercel.json):
//     /api/cron/sync                         -> today (UTC)
//     /api/cron/sync?token=ADMIN_TOKEN&date=2026-06-13
//
//   Range backfill (resume-able, for filling history):
//     /api/cron/sync?token=ADMIN_TOKEN&start=2026-01-01&end=2026-06-15&max=30
//     -> processes up to `max` days starting at `start`, then returns
//        { done_through, next, complete }. Re-call with start=<next> until
//        complete=true. Upserts are idempotent, so repeats are safe.
//
// Auth: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
// when CRON_SECRET is set. Manual calls use ?token=<ADMIN_TOKEN>.

export const dynamic = "force-dynamic";
// Capped by your Vercel plan (Hobby is lower). If a range call times out,
// use a smaller `max`.
export const maxDuration = 300;

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

async function syncOneDay(sb: SupabaseClient, date: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const brand of [BRANDS.own, BRANDS.competitor]) {
    const rows = await fetchVisibility(brand, date);
    const records = rows.map((r) => ({ date, brand, ...r }));
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error } = await sb
        .from("visibility_daily")
        .upsert(chunk, { onConflict: "date,brand,tag" });
      if (error) throw error;
    }
    counts[brand] = rows.length;
  }
  return counts;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const sb = getServerSupabase();

  // ---------- Range backfill mode ----------
  const start = sp.get("start");
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
        const counts = await syncOneDay(sb, cursor);
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
      days_done: processed.length,
      done_through: doneThrough,
      next: complete ? null : doneThrough ? nextDay(doneThrough) : start,
      complete,
      processed,
    });
  }

  // ---------- Single-day mode ----------
  const date = sp.get("date") ?? todayUTC();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const counts = await syncOneDay(sb, date);
    return NextResponse.json({ ok: true, mode: "single", date, ...counts });
  } catch (e) {
    return NextResponse.json(
      { ok: false, mode: "single", date, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
