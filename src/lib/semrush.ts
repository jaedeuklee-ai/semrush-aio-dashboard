// SEMrush Enterprise AIO client for the Phase 1 visibility element (44d76a1d).
// Mirrors the validated cURL exactly, parameterized by brand + date.
// All identifiers/keys come from env vars (never hardcode the API key).

export interface SemrushVisibilityRow {
  tag: string;
  visibility: number | null;
  sov: number | null;
  avg_position: number | null;
  mentions: number | null;
  prompts: number | null;
  prompts_mentioned: number | null;
  unique_prompts: number | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function int(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}
function prevDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function fetchVisibility(
  brand: string,
  date: string,
): Promise<SemrushVisibilityRow[]> {
  const key = process.env.SEMRUSH_API_KEY;
  const workspace = process.env.SEMRUSH_WORKSPACE_ID;
  const project = process.env.SEMRUSH_PROJECT_ID;
  const element = process.env.SEMRUSH_VISIBILITY_ELEMENT_ID;

  if (!key || !workspace || !project || !element) {
    throw new Error(
      "Missing SEMRUSH_* env vars (SEMRUSH_API_KEY, SEMRUSH_WORKSPACE_ID, " +
        "SEMRUSH_PROJECT_ID, SEMRUSH_VISIBILITY_ELEMENT_ID).",
    );
  }

  const prev = prevDay(date);
  const url = `https://api.semrush.com/apis/v4-raw/external-api/v1/workspaces/${workspace}/products/ai/elements/${element}`;

  const body = {
    render_data: {
      comparison_data_formatting: "join",
      project_id: project,
      filters: {
        simple: { project_id: project },
        advanced: {
          op: "and",
          filters: [
            { op: "eq", val: brand, col: "CBF_brand" },
            { op: "gte", val: date, col: "CBF_date__start" },
            { op: "lte", val: date, col: "CBF_date__end" },
            { op: "gte", val: prev, col: "CBF_date__start_comparison" },
            { op: "lte", val: prev, col: "CBF_date__end_comparison" },
          ],
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Apikey ${key}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SEMrush ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { blocks?: { data?: unknown } };
  const rows = json?.blocks?.data;
  if (!Array.isArray(rows)) {
    throw new Error("Unexpected SEMrush response shape (no blocks.data[]).");
  }

  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      tag: String(row.tag),
      visibility: num(row.visibility),
      sov: num(row.sov),
      avg_position: num(row.avg_position),
      mentions: int(row.mentions),
      prompts: int(row.prompts),
      prompts_mentioned: int(row.prompts_mentioned),
      unique_prompts: int(row.unique_prompts),
    };
  });
}

// ---------------------------------------------------------------------------
// Phase 3 baseline: topic-level cited sources (element 553cd819).
// The topic is NOT in the response — it comes from the CBF_tags request
// filter, so callers pass `tag` and we stamp it onto each row.
// ---------------------------------------------------------------------------
export interface SemrushCitationRow {
  source: string;
  domain_type: string | null;
  citation_share: number | null;
  mentions: number | null;
  mentions_diff: number | null;
  position: number | null;
  prompts_with_citation: number | null;
  total_citations: number | null;
  total_responses: number | null;
}

export async function fetchTopicCitations(
  tag: string,
  date: string,
): Promise<SemrushCitationRow[]> {
  const key = process.env.SEMRUSH_API_KEY;
  const workspace = process.env.SEMRUSH_WORKSPACE_ID;
  const project = process.env.SEMRUSH_PROJECT_ID;
  const element = process.env.SEMRUSH_TOPIC_CITATIONS_ELEMENT_ID;

  if (!key || !workspace || !project || !element) {
    throw new Error(
      "Missing SEMRUSH_* env vars (SEMRUSH_API_KEY, SEMRUSH_WORKSPACE_ID, " +
        "SEMRUSH_PROJECT_ID, SEMRUSH_TOPIC_CITATIONS_ELEMENT_ID).",
    );
  }

  const prev = prevDay(date);
  const url = `https://api.semrush.com/apis/v4-raw/external-api/v1/workspaces/${workspace}/products/ai/elements/${element}`;

  const body = {
    render_data: {
      comparison_data_formatting: "join",
      project_id: project,
      filters: {
        simple: {
          project_id: project,
          CBF_date__start: date,
          CBF_date__end: date,
          CBF_date__start_comparison: prev,
          CBF_date__end_comparison: prev,
        },
        advanced: {
          op: "and",
          filters: [
            { op: "or", filters: [{ op: "eq", val: tag, col: "CBF_tags" }] },
            { op: "gte", val: date, col: "CBF_date__start" },
            { op: "lte", val: date, col: "CBF_date__end" },
            { op: "gte", val: prev, col: "CBF_date__start_comparison" },
            { op: "lte", val: prev, col: "CBF_date__end_comparison" },
          ],
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Apikey ${key}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SEMrush ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { blocks?: { data?: unknown } };
  const rows = json?.blocks?.data;
  if (!Array.isArray(rows)) {
    throw new Error("Unexpected SEMrush response shape (no blocks.data[]).");
  }

  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      source: String(row.source ?? ""),
      domain_type: typeof row.domain_type === "string" ? row.domain_type : null,
      citation_share: num(row.citation_share),
      mentions: int(row.mentions_end),
      mentions_diff: int(row.mentions_diff),
      position: num(row.position_end),
      prompts_with_citation: int(row.prompts_with_citation),
      total_citations: int(row.total_citations),
      total_responses: int(row.total_responses),
    };
  });
}

// ===========================================================================
// Prompt-level elements (path A). The (tag, prompt) pair is the join key;
// callers pass both and we stamp them onto every row.
//   prompt-brands  414352b4  — which brands appear for a prompt (+ volume)
//   prompt-citations 7db0df5c — cited URLs for a (tag, prompt)
//   prompt-fanout  e1ff0bf7  — sub-queries a prompt expands into
// Element IDs default to the known values so no extra env vars are required.
// ===========================================================================

const PROMPT_BRANDS_ELEMENT = "414352b4-a4c6-4f13-abf5-2d698498e55f";
const PROMPT_CITATIONS_ELEMENT = "7db0df5c-6679-4495-8ea8-ef2dfd7e5251";
const PROMPT_FANOUT_ELEMENT = "e1ff0bf7-20e9-460e-a82b-d1da99c3aed6";

function semrushCreds(elementEnv: string | undefined, fallback: string) {
  const key = process.env.SEMRUSH_API_KEY;
  const workspace = process.env.SEMRUSH_WORKSPACE_ID;
  const project = process.env.SEMRUSH_PROJECT_ID;
  const element = elementEnv ?? fallback;
  if (!key || !workspace || !project) {
    throw new Error("Missing SEMRUSH_API_KEY / SEMRUSH_WORKSPACE_ID / SEMRUSH_PROJECT_ID.");
  }
  return { key, workspace, project, element };
}

async function postSemrush(
  workspace: string,
  element: string,
  key: string,
  body: unknown,
): Promise<Record<string, unknown>[]> {
  const url = `https://api.semrush.com/apis/v4-raw/external-api/v1/workspaces/${workspace}/products/ai/elements/${element}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Apikey ${key}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SEMrush ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { blocks?: { data?: unknown } };
  const rows = json?.blocks?.data;
  if (!Array.isArray(rows)) throw new Error("Unexpected SEMrush response shape (no blocks.data[]).");
  return rows as Record<string, unknown>[];
}

function priorWindow(start: string, end: string): { cStart: string; cEnd: string } {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const cEnd = new Date(s);
  cEnd.setUTCDate(cEnd.getUTCDate() - 1);
  const cStart = new Date(cEnd);
  cStart.setUTCDate(cStart.getUTCDate() - (days - 1));
  return { cStart: cStart.toISOString().slice(0, 10), cEnd: cEnd.toISOString().slice(0, 10) };
}

export interface SemrushPromptBrandRow {
  prompt: string;
  model: string | null;
  brands_list: string[];
  brands_amount: number | null;
  volume: number | null;
  date: string | null;
}

export async function fetchPromptBrands(
  tag: string,
  prompt: string,
  start: string,
  end: string,
): Promise<SemrushPromptBrandRow[]> {
  const { key, workspace, project, element } = semrushCreds(
    process.env.SEMRUSH_PROMPT_BRANDS_ELEMENT_ID,
    PROMPT_BRANDS_ELEMENT,
  );
  const { cStart, cEnd } = priorWindow(start, end);
  const body = {
    render_data: {
      comparison_data_formatting: "join",
      project_id: project,
      filters: {
        simple: { project_id: project },
        advanced: {
          op: "and",
          filters: [
            { op: "or", filters: [{ op: "eq", val: tag, col: "CBF_tags" }] },
            { col: "prompt", op: "contains", val: prompt },
            { op: "gte", val: start, col: "CBF_date__start" },
            { op: "lte", val: end, col: "CBF_date__end" },
            { op: "gte", val: cStart, col: "CBF_date__start_comparison" },
            { op: "lte", val: cEnd, col: "CBF_date__end_comparison" },
          ],
        },
      },
    },
  };
  const rows = await postSemrush(workspace, element, key, body);
  return rows.map((row) => ({
    prompt: String(row.prompt ?? prompt),
    model: typeof row.model === "string" ? row.model : null,
    brands_list: Array.isArray(row.brands_list) ? row.brands_list.map((b) => String(b)) : [],
    brands_amount: int(row.brands_amount),
    volume: int(row.volume),
    date: typeof row.date === "string" ? row.date.slice(0, 10) : null,
  }));
}

export interface SemrushPromptCitationRow {
  source_url: string;
  source_title: string | null;
  citations: number | null;
  latest_date: string | null;
}

export async function fetchPromptCitations(
  tag: string,
  prompt: string,
  start: string,
  end: string,
): Promise<SemrushPromptCitationRow[]> {
  const { key, workspace, project, element } = semrushCreds(
    process.env.SEMRUSH_PROMPT_CITATIONS_ELEMENT_ID,
    PROMPT_CITATIONS_ELEMENT,
  );
  const { cStart, cEnd } = priorWindow(start, end);
  const body = {
    render_data: {
      comparison_data_formatting: "join",
      project_id: project,
      filters: {
        simple: { project_id: project, keyword: prompt },
        advanced: {
          op: "and",
          filters: [
            { op: "or", filters: [{ op: "eq", val: tag, col: "CBF_tags" }] },
            { op: "gte", val: start, col: "CBF_date__start" },
            { op: "lte", val: end, col: "CBF_date__end" },
            { op: "gte", val: cStart, col: "CBF_date__start_comparison" },
            { op: "lte", val: cEnd, col: "CBF_date__end_comparison" },
          ],
        },
      },
    },
  };
  const rows = await postSemrush(workspace, element, key, body);
  return rows.map((row) => ({
    source_url: String(row.source_url ?? ""),
    source_title: typeof row.source_title === "string" ? row.source_title : null,
    citations: int(row.citations),
    latest_date: typeof row.latest_date === "string" ? row.latest_date.slice(0, 10) : null,
  }));
}

export interface SemrushPromptFanoutRow {
  prompt: string;
  query: string;
  count: number | null;
}

export async function fetchPromptFanout(
  tag: string,
  prompt: string,
  start: string,
  end: string,
): Promise<SemrushPromptFanoutRow[]> {
  const { key, workspace, project, element } = semrushCreds(
    process.env.SEMRUSH_PROMPT_FANOUT_ELEMENT_ID,
    PROMPT_FANOUT_ELEMENT,
  );
  const body = {
    render_data: {
      project_id: project,
      filters: {
        simple: { start_date: start, end_date: end, project_id: project },
        advanced: {
          op: "and",
          filters: [
            { col: "prompt", op: "contains", val: prompt },
            { op: "or", filters: [{ op: "eq", val: tag, col: "CBF_tags" }] },
          ],
        },
      },
    },
  };
  const rows = await postSemrush(workspace, element, key, body);
  return rows.map((row) => ({
    prompt: String(row.prompt ?? prompt),
    query: String(row.query ?? ""),
    count: int(row.count),
  }));
}
