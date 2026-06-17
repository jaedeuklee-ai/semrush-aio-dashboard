import type Anthropic from "@anthropic-ai/sdk";
import { getServerSupabase } from "./supabase";
import { normalizeUrl } from "./url-normalize";
import { BRANDS } from "@/config/brands";
import { categoryOf, CATEGORY_TOTAL_TAG, type Category } from "./categories";
import { ensurePrompt } from "./prompt-loader";

// Max number of NEW prompts to fetch from SEMrush within a single tool call,
// to stay under the function time limit. Cached prompts don't count, so repeat
// calls progressively fill the cache.
const ONDEMAND_FETCH_BUDGET = 4;

// ---------------------------------------------------------------------------
// Tools the agent can call. Each is a read-only query over the dashboard DB.
// Keep outputs compact — they go back into the model's context.
// ---------------------------------------------------------------------------

// The newest date actually present in the data (so ranges track real data,
// not the server clock).
async function latestDataDate(sb: ReturnType<typeof getServerSupabase>): Promise<string | null> {
  const { data } = await sb
    .from("visibility_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.date as string) ?? null;
}

// Resolve a date range: default end = latest available date, start = end − 29d.
async function resolveRange(
  sb: ReturnType<typeof getServerSupabase>,
  start?: string,
  end?: string,
): Promise<{ start: string; end: string }> {
  let e = end;
  if (!e) e = (await latestDataDate(sb)) ?? new Date().toISOString().slice(0, 10);
  let s = start;
  if (!s) {
    const d = new Date(e + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 29);
    s = d.toISOString().slice(0, 10);
  }
  return { start: s, end: e };
}

const round = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);

// Normalize a tag/topic string for forgiving comparison (case, spaces,
// underscores, separators all collapse).
function normTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function allKnownTags(sb: ReturnType<typeof getServerSupabase>): Promise<string[]> {
  const wl = await sb.from("topic_whitelist").select("tag");
  const pm = await sb.from("prompt_map").select("tag");
  const set = new Set<string>();
  (wl.data ?? []).forEach((r) => set.add(r.tag as string));
  (pm.data ?? []).forEach((r) => set.add(r.tag as string));
  return [...set];
}

// Map whatever the model passed (often a guessed tag like "tv__oled_tv" or
// "oled tv") to a real tag. Returns the resolved tag, or candidates to suggest.
async function resolveTag(
  sb: ReturnType<typeof getServerSupabase>,
  raw: string,
): Promise<{ tag?: string; candidates?: string[] }> {
  const tags = await allKnownTags(sb);
  if (tags.includes(raw)) return { tag: raw };
  const n = normTag(raw);
  const exact = tags.find((t) => normTag(t) === n);
  if (exact) return { tag: exact };
  const contains = tags.filter((t) => {
    const tn = normTag(t);
    return tn.includes(n) || n.includes(tn);
  });
  if (contains.length === 1) return { tag: contains[0] };
  if (contains.length > 1) return { candidates: contains.slice(0, 10) };
  const tokens = n.split(" ").filter(Boolean);
  const scored = tags
    .map((t) => {
      const tn = normTag(t);
      return { t, score: tokens.filter((tok) => tn.includes(tok)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length && scored[0].score === tokens.length) return { tag: scored[0].t };
  if (scored.length) return { candidates: scored.slice(0, 10).map((x) => x.t) };
  return { candidates: [] };
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "data_coverage",
    description:
      "Report what data actually exists: the earliest and latest date and row counts per table (visibility, topic citations, prompt-level tables). ALWAYS call this first if you are unsure which dates have data — do not assume the current year. Use the latest available date as the basis for ranges.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_topics",
    description:
      "List the tracked topics (the whitelist) with their category (TV/Audio/Monitor). Use this to discover what tags exist before querying others. Optionally filter by category.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["TV", "Audio", "Monitor"] },
      },
    },
  },
  {
    name: "topic_visibility",
    description:
      "Average AI-search visibility for specific topics over a date range, for LG and Samsung side by side, with the gap (LG − Samsung; negative = LG behind). Pass the exact tags from list_topics.",
    input_schema: {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        start: { type: "string", description: "YYYY-MM-DD (optional, default last 30d)" },
        end: { type: "string", description: "YYYY-MM-DD (optional, default today)" },
      },
      required: ["tags"],
    },
  },
  {
    name: "weak_topics",
    description:
      "Topics where LG trails Samsung the most (widest negative gap) over a date range. Use to find weaknesses. Optionally restrict to a category. Excludes the category Total rows.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["TV", "Audio", "Monitor"] },
        start: { type: "string" },
        end: { type: "string" },
        limit: { type: "number", description: "default 10" },
      },
    },
  },
  {
    name: "topic_citations",
    description:
      "Which sources (URLs) AI answers cite for a given topic, over a date range. Returns top sources by citation share, with their channel type (Owned/Earned/Social/Other) and whether the URL belongs to LG's owned-content list. Use to see who wins citations on a topic.",
    input_schema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        limit: { type: "number", description: "default 15" },
      },
      required: ["tag"],
    },
  },
  {
    name: "owned_coverage",
    description:
      "For a topic, cross-check LG's owned-content URLs against the sources actually cited by AI answers. Returns how many owned URLs are cited vs not, the cited owned URLs, and a few top non-owned (competitor/other) cited URLs. Use to judge whether LG's own pages are being picked up.",
    input_schema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
      },
      required: ["tag"],
    },
  },
  {
    name: "prompt_gaps",
    description:
      "Prompts where the competitor appears in the AI answer but LG does NOT — the biggest prompt-level gaps. Sorted by prompt search volume (impact). Optionally restrict to a tag or a category. Use to find where to win new visibility.",
    input_schema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "exact whitelist tag (optional)" },
        category: { type: "string", enum: ["TV", "Audio", "Monitor"] },
        limit: { type: "number", description: "default 15" },
      },
    },
  },
  {
    name: "prompt_sources",
    description:
      "The URLs that AI answers cite for a specific (tag, prompt), sorted by citation count, with channel type (Reddit/Wiki/YouTube/Owned/Other) and whether the URL is LG-owned. Use to see what content currently wins a prompt.",
    input_schema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        prompt: { type: "string" },
        limit: { type: "number", description: "default 15" },
      },
      required: ["tag", "prompt"],
    },
  },
  {
    name: "prompt_fanout",
    description:
      "The sub-queries (query fan-out) that an AI engine expands a prompt into, for a (tag, prompt). Use to understand what sub-intents content must cover to be retrieved.",
    input_schema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["tag", "prompt"],
    },
  },
  {
    name: "prompt_brands",
    description:
      "Which brands appeared in the AI answer for a specific (tag, prompt), plus the prompt's search volume and whether LG/competitor were present. Use to confirm a single prompt's competitive picture.",
    input_schema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["tag", "prompt"],
    },
  },
];

type ToolInput = Record<string, unknown>;

export async function runTool(name: string, input: ToolInput): Promise<unknown> {
  const sb = getServerSupabase();

  if (name === "data_coverage") {
    async function span(table: string, dateCol: string | null) {
      const countRes = await sb.from(table).select("*", { count: "exact", head: true });
      const out: Record<string, unknown> = { rows: countRes.count ?? 0 };
      if (dateCol) {
        const min = await sb.from(table).select(dateCol).order(dateCol, { ascending: true }).limit(1).maybeSingle();
        const max = await sb.from(table).select(dateCol).order(dateCol, { ascending: false }).limit(1).maybeSingle();
        out.earliest = (min.data as Record<string, unknown> | null)?.[dateCol] ?? null;
        out.latest = (max.data as Record<string, unknown> | null)?.[dateCol] ?? null;
      }
      return out;
    }
    return {
      visibility_daily: await span("visibility_daily", "date"),
      topic_citations: await span("topic_citations", "date"),
      prompt_brands: await span("prompt_brands", null),
      prompt_citations: await span("prompt_citations", null),
      prompt_fanout: await span("prompt_fanout", null),
      prompt_map: await span("prompt_map", null),
    };
  }

  if (name === "list_topics") {
    const category = input.category as Category | undefined;
    const { data, error } = await sb.from("topic_whitelist").select("tag,label");
    if (error) throw error;
    let rows = (data ?? []).map((r) => ({
      tag: r.tag as string,
      label: (r.label as string) ?? null,
      category: categoryOf(r.tag as string),
    }));
    if (category) rows = rows.filter((r) => r.category === category);
    return { count: rows.length, topics: rows };
  }

  if (name === "topic_visibility") {
    const rawTags = (input.tags as string[]) ?? [];
    if (rawTags.length === 0) return { error: "no tags provided" };
    const resolved: string[] = [];
    const unresolved: { input: string; did_you_mean: string[] }[] = [];
    for (const rt of rawTags) {
      const r = await resolveTag(sb, rt);
      if (r.tag) resolved.push(r.tag);
      else unresolved.push({ input: rt, did_you_mean: r.candidates ?? [] });
    }
    const tags = resolved;
    if (tags.length === 0) {
      return { error: "none of the tags were found", unresolved };
    }
    const { start, end } = await resolveRange(sb, input.start as string, input.end as string);
    const { data, error } = await sb
      .from("visibility_daily")
      .select("tag,brand,visibility")
      .in("tag", tags)
      .gte("date", start)
      .lte("date", end);
    if (error) throw error;

    const acc = new Map<string, { lg: number[]; sa: number[] }>();
    for (const r of data ?? []) {
      const a = acc.get(r.tag as string) ?? { lg: [], sa: [] };
      const v = r.visibility as number | null;
      if (v != null) {
        if (r.brand === BRANDS.own) a.lg.push(v);
        else if (r.brand === BRANDS.competitor) a.sa.push(v);
      }
      acc.set(r.tag as string, a);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const rows = tags.map((tag) => {
      const a = acc.get(tag) ?? { lg: [], sa: [] };
      const lg = avg(a.lg);
      const sa = avg(a.sa);
      return { tag, lg: round(lg), samsung: round(sa), gap: lg != null && sa != null ? round(lg - sa) : null };
    });
    return { range: { start, end }, rows, unresolved: unresolved.length ? unresolved : undefined };
  }

  if (name === "weak_topics") {
    const category = input.category as Category | undefined;
    const limit = (input.limit as number) ?? 10;
    const { start, end } = await resolveRange(sb, input.start as string, input.end as string);

    const wl = await sb.from("topic_whitelist").select("tag,label");
    if (wl.error) throw wl.error;
    let tags = (wl.data ?? []).map((r) => r.tag as string);
    if (category) tags = tags.filter((t) => categoryOf(t) === category);
    // exclude the category Total rows
    const totals = new Set(Object.values(CATEGORY_TOTAL_TAG));
    tags = tags.filter((t) => !totals.has(t));
    if (tags.length === 0) return { range: { start, end }, rows: [] };

    const { data, error } = await sb
      .from("visibility_daily")
      .select("tag,brand,visibility")
      .in("tag", tags)
      .gte("date", start)
      .lte("date", end);
    if (error) throw error;

    const acc = new Map<string, { lg: number[]; sa: number[] }>();
    for (const r of data ?? []) {
      const a = acc.get(r.tag as string) ?? { lg: [], sa: [] };
      const v = r.visibility as number | null;
      if (v != null) {
        if (r.brand === BRANDS.own) a.lg.push(v);
        else if (r.brand === BRANDS.competitor) a.sa.push(v);
      }
      acc.set(r.tag as string, a);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const labelOf = new Map((wl.data ?? []).map((r) => [r.tag as string, (r.label as string) ?? null]));
    const rows = [...acc.entries()]
      .map(([tag, a]) => {
        const lg = avg(a.lg);
        const sa = avg(a.sa);
        return {
          tag,
          label: labelOf.get(tag) ?? null,
          lg: round(lg),
          samsung: round(sa),
          gap: lg != null && sa != null ? round(lg - sa) : null,
        };
      })
      .filter((r) => r.gap != null)
      .sort((x, y) => (x.gap as number) - (y.gap as number))
      .slice(0, limit);
    return { range: { start, end }, rows };
  }

  if (name === "topic_citations" || name === "owned_coverage") {
    const rawTag = input.tag as string;
    if (!rawTag) return { error: "no tag provided" };
    const rt = await resolveTag(sb, rawTag);
    if (!rt.tag) return { error: `tag not found: "${rawTag}"`, did_you_mean: rt.candidates ?? [] };
    const tag = rt.tag;
    const { start, end } = await resolveRange(sb, input.start as string, input.end as string);

    const { data, error } = await sb
      .from("topic_citations")
      .select("source_url,domain_type,citation_share,mentions")
      .eq("tag", tag)
      .gte("date", start)
      .lte("date", end);
    if (error) throw error;

    // owned URL set (normalized)
    const owned = await sb.from("owned_content").select("url_normalized");
    if (owned.error) throw owned.error;
    const ownedSet = new Set((owned.data ?? []).map((r) => r.url_normalized as string));

    // aggregate per source_url over the range
    const acc = new Map<string, { share: number[]; mentions: number; domain_type: string | null }>();
    for (const r of data ?? []) {
      const url = r.source_url as string;
      const a = acc.get(url) ?? { share: [], mentions: 0, domain_type: (r.domain_type as string) ?? null };
      if (r.citation_share != null) a.share.push(r.citation_share as number);
      a.mentions += (r.mentions as number) ?? 0;
      acc.set(url, a);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const all = [...acc.entries()]
      .map(([url, a]) => {
        const norm = normalizeUrl(url);
        return {
          source_url: url,
          domain_type: a.domain_type,
          citation_share: round(avg(a.share)),
          mentions: a.mentions,
          is_lg_owned: norm ? ownedSet.has(norm.normalized) : false,
        };
      })
      .sort((x, y) => (y.citation_share ?? 0) - (x.citation_share ?? 0));

    if (name === "topic_citations") {
      const limit = (input.limit as number) ?? 15;
      return { tag, range: { start, end }, total_sources: all.length, sources: all.slice(0, limit) };
    }

    // owned_coverage
    const cited = all.filter((s) => s.is_lg_owned);
    const notOwned = all.filter((s) => !s.is_lg_owned).slice(0, 8);
    return {
      tag,
      range: { start, end },
      owned_urls_total: ownedSet.size,
      owned_urls_cited: cited.length,
      cited_owned_urls: cited.map((s) => ({ url: s.source_url, citation_share: s.citation_share })),
      top_non_owned_cited: notOwned.map((s) => ({
        url: s.source_url,
        domain_type: s.domain_type,
        citation_share: s.citation_share,
      })),
    };
  }

  if (name === "prompt_gaps") {
    const rawTag = input.tag as string | undefined;
    const category = input.category as Category | undefined;
    const limit = (input.limit as number) ?? 15;

    let tag: string | undefined;
    if (rawTag) {
      const r = await resolveTag(sb, rawTag);
      if (!r.tag) {
        return { error: `tag not found: "${rawTag}"`, did_you_mean: r.candidates ?? [] };
      }
      tag = r.tag;
    }

    // On-demand: if a specific tag is given, fetch a bounded number of its
    // not-yet-cached prompts from prompt_map so gaps can be computed.
    let loadedNow = 0;
    let remaining = 0;
    if (tag) {
      const mapRows = await sb.from("prompt_map").select("prompt").eq("tag", tag);
      const prompts = (mapRows.data ?? []).map((r) => r.prompt as string);
      for (const p of prompts) {
        if (loadedNow >= ONDEMAND_FETCH_BUDGET) {
          remaining++;
          continue;
        }
        const fetched = await ensurePrompt(sb, tag, p);
        if (fetched) loadedNow++;
      }
    }

    let q = sb
      .from("prompt_brands")
      .select("tag,prompt,volume,brands_amount,lg_present,samsung_present")
      .eq("samsung_present", true)
      .eq("lg_present", false);
    if (tag) q = q.eq("tag", tag);
    const { data, error } = await q;
    if (error) throw error;
    let rows = (data ?? []).map((r) => ({
      tag: r.tag as string,
      prompt: r.prompt as string,
      volume: (r.volume as number) ?? 0,
      brands_amount: (r.brands_amount as number) ?? 0,
    }));
    if (category) rows = rows.filter((r) => categoryOf(r.tag) === category);
    rows.sort((a, b) => b.volume - a.volume);
    return {
      count: rows.length,
      loaded_now: loadedNow,
      more_to_load: remaining > 0 ? remaining : 0,
      note:
        remaining > 0
          ? "Some prompts for this tag aren't cached yet. Ask again to load more."
          : null,
      prompts: rows.slice(0, limit),
    };
  }

  if (name === "prompt_sources") {
    const rawTag = input.tag as string;
    const prompt = input.prompt as string;
    const limit = (input.limit as number) ?? 15;
    if (!rawTag || !prompt) return { error: "tag and prompt required" };
    const rt = await resolveTag(sb, rawTag);
    if (!rt.tag) return { error: `tag not found: "${rawTag}"`, did_you_mean: rt.candidates ?? [] };
    const tag = rt.tag;
    await ensurePrompt(sb, tag, prompt);
    const owned = await sb.from("owned_content").select("url_normalized");
    if (owned.error) throw owned.error;
    const ownedSet = new Set((owned.data ?? []).map((r) => r.url_normalized as string));
    const { data, error } = await sb
      .from("prompt_citations")
      .select("source_url,source_title,citations")
      .eq("tag", tag)
      .eq("prompt", prompt);
    if (error) throw error;
    const rows = (data ?? [])
      .map((r) => {
        const url = r.source_url as string;
        const norm = normalizeUrl(url);
        return {
          source_url: url,
          source_title: (r.source_title as string) ?? null,
          citations: (r.citations as number) ?? 0,
          channel: classifyDomain(url, norm?.normalized, ownedSet),
          is_lg_owned: norm ? ownedSet.has(norm.normalized) : false,
        };
      })
      .sort((a, b) => b.citations - a.citations)
      .slice(0, limit);
    return { tag, prompt, total_sources: data?.length ?? 0, sources: rows };
  }

  if (name === "prompt_fanout") {
    const rawTag = input.tag as string;
    const prompt = input.prompt as string;
    if (!rawTag || !prompt) return { error: "tag and prompt required" };
    const rt = await resolveTag(sb, rawTag);
    if (!rt.tag) return { error: `tag not found: "${rawTag}"`, did_you_mean: rt.candidates ?? [] };
    const tag = rt.tag;
    await ensurePrompt(sb, tag, prompt);
    const { data, error } = await sb
      .from("prompt_fanout")
      .select("query,count")
      .eq("tag", tag)
      .eq("prompt", prompt);
    if (error) throw error;
    const rows = (data ?? [])
      .map((r) => ({ query: r.query as string, count: (r.count as number) ?? 0 }))
      .sort((a, b) => b.count - a.count);
    return { tag, prompt, count: rows.length, queries: rows };
  }

  if (name === "prompt_brands") {
    const rawTag = input.tag as string;
    const prompt = input.prompt as string;
    if (!rawTag || !prompt) return { error: "tag and prompt required" };
    const rt = await resolveTag(sb, rawTag);
    if (!rt.tag) return { error: `tag not found: "${rawTag}"`, did_you_mean: rt.candidates ?? [] };
    const tag = rt.tag;
    await ensurePrompt(sb, tag, prompt);
    const { data, error } = await sb
      .from("prompt_brands")
      .select("brands_list,brands_amount,volume,lg_present,samsung_present,models")
      .eq("tag", tag)
      .eq("prompt", prompt)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { tag, prompt, found: false };
    return { tag, prompt, found: true, ...data };
  }

  return { error: `unknown tool: ${name}` };
}

function classifyDomain(
  url: string,
  normalized: string | undefined,
  ownedSet: Set<string>,
): string {
  if (normalized && ownedSet.has(normalized)) return "Owned";
  const d = (normalized ?? url).toLowerCase();
  if (d.includes("reddit.com")) return "Reddit";
  if (d.includes("youtube.com") || d.includes("youtu.be")) return "YouTube";
  if (d.includes("wikipedia.org") || d.includes(".wiki")) return "Wiki";
  if (d.includes("quora.com")) return "Quora";
  if (d.includes("lg.com")) return "Owned";
  if (d.includes("samsung.com")) return "Competitor";
  if (
    d.includes("prnewswire") ||
    d.includes("businesswire") ||
    d.includes("globenewswire") ||
    d.includes("/press")
  )
    return "PR";
  return "Other";
}
