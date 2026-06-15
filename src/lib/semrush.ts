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
