import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { fetchVisibility } from "@/lib/semrush";
import { BRANDS } from "@/config/brands";

// Daily SEMrush sync. Scheduled by Vercel Cron (see vercel.json) and also
// triggerable manually for backfill: /api/cron/sync?token=ADMIN_TOKEN&date=2026-06-10
//
// Auth: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when the
// CRON_SECRET env var is set. Manual calls use ?token=<ADMIN_TOKEN>.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get("date") ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const sb = getServerSupabase();
  const summary: Record<string, number | string> = { date };

  try {
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
      summary[brand] = rows.length;
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), summary },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, summary });
}
