import type { SupabaseClient } from "@supabase/supabase-js";

// Shared backfill engine used by /api/cron/sync and /api/cron/citations.
//
// Each HTTP invocation processes a small chunk of days (well under the Vercel
// function time limit), records progress in sync_state, then triggers the next
// chunk by fetching its own URL. Because the next invocation responds
// immediately (chain mode) and continues its real work in waitUntil(), the
// trigger fetch returns fast and the chain walks forward day by day until it
// reaches `end`. If a chunk errors or a trigger fails, the chain stops and
// sync_state shows where to resume — just re-run from last_done + 1.

export function nextDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface SyncState {
  job: string;
  end_date: string | null;
  last_done: string | null;
  status: string;
  message: string | null;
  updated_at: string;
}

export async function setState(
  sb: SupabaseClient,
  job: string,
  fields: { end_date?: string; last_done?: string | null; status: string; message?: string | null },
): Promise<void> {
  await sb.from("sync_state").upsert(
    {
      job,
      end_date: fields.end_date ?? null,
      last_done: fields.last_done ?? null,
      status: fields.status,
      message: fields.message ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "job" },
  );
}

export async function getState(sb: SupabaseClient, job: string): Promise<SyncState | null> {
  const { data } = await sb.from("sync_state").select("*").eq("job", job).maybeSingle();
  return (data as SyncState) ?? null;
}

interface RunChunkOpts {
  sb: SupabaseClient;
  job: string;
  start: string;
  end: string;
  max: number;
  processDay: (sb: SupabaseClient, date: string) => Promise<number>;
  nextUrlFor: (startDate: string) => string;
}

export async function runChunk(o: RunChunkOpts): Promise<void> {
  let cursor = o.start;
  let doneThrough: string | null = null;

  try {
    for (let i = 0; i < o.max && cursor <= o.end; i++) {
      await o.processDay(o.sb, cursor);
      doneThrough = cursor;
      await setState(o.sb, o.job, { end_date: o.end, last_done: cursor, status: "running" });
      cursor = nextDay(cursor);
    }
  } catch (e) {
    await setState(o.sb, o.job, {
      end_date: o.end,
      last_done: doneThrough,
      status: "error",
      message: e instanceof Error ? e.message : String(e),
    });
    return; // stop the chain; resume later from last_done + 1
  }

  if (doneThrough !== null && doneThrough >= o.end) {
    await setState(o.sb, o.job, { end_date: o.end, last_done: doneThrough, status: "complete" });
    return;
  }

  // Not finished — trigger the next chunk. The next invocation replies
  // immediately (chain mode), so this resolves quickly.
  const next = nextDay(doneThrough ?? o.start);
  try {
    await fetch(o.nextUrlFor(next), { cache: "no-store" });
  } catch {
    await setState(o.sb, o.job, {
      end_date: o.end,
      last_done: doneThrough,
      status: "stalled",
      message: "could not trigger next chunk; re-run to resume",
    });
  }
}
