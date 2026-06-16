import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { getServerSupabase } from "@/lib/supabase";
import { fetchVisibility } from "@/lib/semrush";
import { BRANDS } from "@/config/brands";
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
// Auth: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
// when CRON_SECRET is set. Manual calls use ?token=<ADMIN_TOKEN>.

export const dynamic = "force-dynamic";
// Vercel Hobby caps this at 60s; each chunk must finish within it.
export const maxDuration = 60;

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

  // ---------- Status check ----------
  if (sp.get("status") === "1") {
    const state = await getState(sb, JOB);
    return NextResponse.json({ ok: true, job: JOB, state });
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
    const base = `${req.nextUrl.origin}${req.nextUrl.pathname}`;
    const nextUrlFor = (s: string) => {
      const u = new URL(base);
      u.searchParams.set("start", s);
      u.searchParams.set("end", end);
      u.searchParams.set("max", String(max));
      u.searchParams.set("chain", "1");
      if (token) u.searchParams.set("token", token);
      return u.toString();
    };

    const processDay = async (client: SupabaseClient, date: string): Promise<number> => {
      const counts = await syncOneDay(client, date);
      return Object.values(counts).reduce((a, b) => a + b, 0);
    };

    // Run in the background and return immediately so the chain isn't blocked.
    waitUntil(runChunk({ sb, job: JOB, start, end, max, processDay, nextUrlFor }));
    return NextResponse.json({
      ok: true,
      accepted: true,
      job: JOB,
      from: start,
      to: end,
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
