import { getServerSupabase } from "./supabase";
import { BRANDS } from "@/config/brands";
import type {
  Topic,
  DailyBrandPoint,
  TotalPoint,
  TopicAverage,
} from "./types";

// ---------------------------------------------------------------------------
// Topics (the tracked-topic whitelist you load via CSV).
// ---------------------------------------------------------------------------
export async function getTopics(): Promise<Topic[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("topic_whitelist")
    .select("tag,label,sort_order")
    .order("sort_order", { ascending: true })
    .order("tag", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r) => ({ tag: r.tag as string, label: (r.label as string) ?? null }));
}

// ---------------------------------------------------------------------------
// Widget 1 — daily visibility for one topic, LG vs Samsung.
// ---------------------------------------------------------------------------
export async function getTopicBrandDaily(
  tag: string,
  start: string,
  end: string,
): Promise<DailyBrandPoint[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("visibility_daily")
    .select("date,brand,visibility")
    .eq("tag", tag)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) throw error;

  const byDate = new Map<string, DailyBrandPoint>();
  for (const r of data ?? []) {
    const date = r.date as string;
    const point = byDate.get(date) ?? { date, LG: null, Samsung: null };
    if (r.brand === BRANDS.own) point.LG = r.visibility as number | null;
    else if (r.brand === BRANDS.competitor) point.Samsung = r.visibility as number | null;
    byDate.set(date, point);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Widget 2 — total visibility time series across ALL tracked topics.
//
// Total is prompt-weighted: sum(prompts_mentioned) / sum(prompts) per day,
// per brand. This is more honest than a plain average of percentages because
// it weights big topics more heavily.
//
// IMPORTANT: this assumes the whitelist topics are mutually exclusive. SEMrush
// tags are hierarchical (e.g. "tv__non-brand" already contains
// "tv__non-brand__oled tv"), so if you whitelist BOTH a parent and its child,
// the total will double-count. Keep the whitelist to one level, or adjust.
// ---------------------------------------------------------------------------
export async function getTotalTimeSeries(
  start: string,
  end: string,
): Promise<TotalPoint[]> {
  const sb = getServerSupabase();
  const topics = await getTopics();
  const tags = topics.map((t) => t.tag);
  if (tags.length === 0) return [];

  const { data, error } = await sb
    .from("visibility_daily")
    .select("date,brand,prompts,prompts_mentioned")
    .in("tag", tags)
    .gte("date", start)
    .lte("date", end);

  if (error) throw error;

  type Acc = { lgMentioned: number; lgPrompts: number; saMentioned: number; saPrompts: number };
  const byDate = new Map<string, Acc>();

  for (const r of data ?? []) {
    const date = r.date as string;
    const acc = byDate.get(date) ?? { lgMentioned: 0, lgPrompts: 0, saMentioned: 0, saPrompts: 0 };
    const prompts = (r.prompts as number) ?? 0;
    const mentioned = (r.prompts_mentioned as number) ?? 0;
    if (r.brand === BRANDS.own) {
      acc.lgMentioned += mentioned;
      acc.lgPrompts += prompts;
    } else if (r.brand === BRANDS.competitor) {
      acc.saMentioned += mentioned;
      acc.saPrompts += prompts;
    }
    byDate.set(date, acc);
  }

  return [...byDate.entries()]
    .map(([date, a]) => ({
      date,
      LG: a.lgPrompts > 0 ? a.lgMentioned / a.lgPrompts : null,
      Samsung: a.saPrompts > 0 ? a.saMentioned / a.saPrompts : null,
    }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

// ---------------------------------------------------------------------------
// Widget 4 — average visibility per topic over the period (simple mean of
// daily visibility values), LG and Samsung side by side, with the gap.
// ---------------------------------------------------------------------------
export async function getTopicAverages(
  start: string,
  end: string,
): Promise<TopicAverage[]> {
  const sb = getServerSupabase();
  const topics = await getTopics();
  const tags = topics.map((t) => t.tag);
  if (tags.length === 0) return [];

  const { data, error } = await sb
    .from("visibility_daily")
    .select("tag,brand,visibility")
    .in("tag", tags)
    .gte("date", start)
    .lte("date", end);

  if (error) throw error;

  type Acc = { sum: number; n: number };
  const key = (tag: string, brand: string) => `${tag}__${brand}`;
  const acc = new Map<string, Acc>();

  for (const r of data ?? []) {
    if (r.visibility == null) continue;
    const k = key(r.tag as string, r.brand as string);
    const a = acc.get(k) ?? { sum: 0, n: 0 };
    a.sum += r.visibility as number;
    a.n += 1;
    acc.set(k, a);
  }

  const mean = (tag: string, brand: string): number | null => {
    const a = acc.get(key(tag, brand));
    return a && a.n > 0 ? a.sum / a.n : null;
  };

  return topics.map((t) => {
    const lg = mean(t.tag, BRANDS.own);
    const samsung = mean(t.tag, BRANDS.competitor);
    return {
      tag: t.tag,
      label: t.label,
      lg,
      samsung,
      gap: lg != null && samsung != null ? lg - samsung : null,
    };
  });
}
