import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { getServerSupabase } from "@/lib/supabase";
import { fetchTopicCitations } from "@/lib/semrush";
import { normalizeUrl } from "@/lib/url-normalize";
import { getState, runChunk } from "@/lib/backfill";

// Fills topic_citations: for each tracked topic, the cited sources on a date.
// Loops the topic_whitelist and calls SEMrush element 553cd819 per topic,
// stamping (date, tag) onto every row (the topic isn't in the response).
//
//   Single day:   /api/cron/citations?token=ADMIN_TOKEN&date=2026-06-01
//   Manual range: /api/cron/citations?token=ADMIN_TOKEN&start=2026-01-01&end=2026-06-15&max=2
//   Auto backfill:/api/cron/citations?token=ADMIN_TOKEN&start=2026-01-01&end=2026-06-16&chain=1
//                 (returns immediately; poll with ?status=1)
//
// One day = one SEMrush call per topic, so chunks stay small.

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby cap

const JOB = "citations";
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

async function getTags(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from("topic_whitelist").select("tag");
  if (error) throw error;
  return (data ?? []).map((r) => r.tag as string);
}

async function citationsForDay(
  sb: SupabaseClient,
  tags: string[],
  date: string,
): Promise<number> {
  let inserted = 0;
  for (const tag of tags) {
    const rows = await fetchTopicCitations(tag, date);
    const records = rows
      .filter((r) => r.source)
      .map((r) => {
        const n = normalizeUrl(r.source);
        return {
          date,
          tag,
          source_url: r.source,
          domain: n?.domain ?? null,
          domain_type: r.domain_type,
          citation_share: r.citation_share,
          mentions: r.mentions,
          mentions_diff: r.mentions_diff,
          position: r.position,
          prompts_with_citation: r.prompts_with_citation,
          total_citations: r.total_citations,
          total_responses: r.total_responses,
        };
      });
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error } = await sb
        .from("topic_citations")
        .upsert(chunk, { onConflict: "date,tag,source_url" });
      if (error) throw error;
    }
    inserted += records.length;
  }
  return inserted;
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

  let tags: string[];
  try {
    tags = await getTags(sb);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  if (tags.length === 0) {
    return NextResponse.json(
      { ok: false, error: "topic_whitelist is empty — load it first (/api/admin/load)." },
      { status: 400 },
    );
  }

  const processDay = (client: SupabaseClient, date: string) => citationsForDay(client, tags, date);

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

    waitUntil(runChunk({ sb, job: JOB, start, end, max, processDay, nextUrlFor }));
    return NextResponse.json({
      ok: true,
      accepted: true,
      job: JOB,
      topics: tags.length,
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

    const processed: Array<{ date: string; rows: number }> = [];
    let cursor = start;
    let doneThrough: string | null = null;
    try {
      for (let i = 0; i < max && cursor <= end; i++) {
        const rows = await citationsForDay(sb, tags, cursor);
        processed.push({ date: cursor, rows });
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
      start,
      end,
      days_done: processed.length,
      done_through: doneThrough,
      next: complete ? null : doneThrough ? nextDay(doneThrough) : start,
      complete,
      processed,
    });
  }

  // ---------- Single day ----------
  const date = sp.get("date") ?? todayUTC();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  try {
    const rows = await citationsForDay(sb, tags, date);
    return NextResponse.json({ ok: true, mode: "single", date, topics: tags.length, rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, mode: "single", date, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
