import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPromptBrands, fetchPromptCitations, fetchPromptFanout } from "./semrush";
import { BRANDS } from "@/config/brands";

// Default lookback window for prompt-level pulls.
export function defaultPromptRange(): { start: string; end: string } {
  const end = new Date().toISOString().slice(0, 10);
  const d = new Date(end + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 29);
  return { start: d.toISOString().slice(0, 10), end };
}

// Fetches the 3 SEMrush prompt elements for one (tag, prompt) and upserts them.
// Used by the batch loader (/api/cron/prompts) and by on-demand agent tools.
export async function loadPrompt(
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
  await sb.from("prompt_brands").upsert(
    {
      tag,
      prompt,
      brands_list: [...brandSet],
      brands_amount: brandSet.size,
      volume,
      lg_present: lower.includes(BRANDS.own.toLowerCase()),
      samsung_present: lower.includes(BRANDS.competitor.toLowerCase()),
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

// Returns true if (tag, prompt) has fresh cached data (within staleDays).
export async function isPromptFresh(
  sb: SupabaseClient,
  tag: string,
  prompt: string,
  staleDays = 30,
): Promise<boolean> {
  const { data } = await sb
    .from("prompt_brands")
    .select("updated_at")
    .eq("tag", tag)
    .eq("prompt", prompt)
    .maybeSingle();
  if (!data?.updated_at) return false;
  const age = Date.now() - new Date(data.updated_at as string).getTime();
  return age < staleDays * 86400000;
}

// Ensure a single prompt is cached; fetch + store on a cache miss.
export async function ensurePrompt(
  sb: SupabaseClient,
  tag: string,
  prompt: string,
): Promise<boolean> {
  if (await isPromptFresh(sb, tag, prompt)) return false; // already cached
  const { start, end } = defaultPromptRange();
  await loadPrompt(sb, tag, prompt, start, end);
  return true; // freshly fetched
}
