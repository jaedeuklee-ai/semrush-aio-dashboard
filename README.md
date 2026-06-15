# AI Visibility Dashboard — SEMrush Enterprise AIO

Internal dashboard tracking **AI search visibility** (share of AI answers) for
**LG vs Samsung** across tracked topics, sourced from SEMrush Enterprise AIO.
Built with Next.js (App Router) + Supabase Postgres, deployable on Vercel.

This repo is the **dashboard + data foundation**. The analysis agent (Phases
1–5) is scaffolded at `src/app/api/agent/route.ts` as the next phase.

---

## What's in here

| Widget | What it shows | Source |
| --- | --- | --- |
| Daily visibility — selected topic | LG vs Samsung, per day, for the chosen topic | `visibility_daily` |
| Total visibility | Prompt-weighted total across all tracked topics, per day | `visibility_daily` |
| Filters | Topic + date range (drive the page via URL params) | `topic_whitelist` |
| All topics — average | Mean visibility per topic over the range, sorted by widest gap | `visibility_daily` |

---

## Data model (who fills what)

- **`visibility_daily`** — the backbone. One row per (date, brand, tag). **You
  populate this** from SEMrush (element `44d76a1d`), e.g. a daily job that pulls
  LG and Samsung for that day and upserts. The dashboard only reads it.
- **`topic_whitelist`** — which tags to show/aggregate. Loaded from
  `data/topic_whitelist.csv`.
- **`owned_content`** — flat list of URLs you publish. Loaded from
  `data/owned_content.csv`. Used later by the agent to tell whether a cited
  source is yours.
- **`topic_citations`** — Phase 3 baseline (cited sources per topic). Schema is
  a starting point; adjust to the real element response when you wire ingestion.

---

## Setup

### 1. Database (Supabase)

Provision Supabase through the **Vercel Marketplace** (Storage → add
integration → Supabase) so credentials are injected automatically. For local
dev, grab the values from Supabase → Project Settings → API.

Then run the schema: Supabase dashboard → **SQL** → paste `supabase/schema.sql`
→ Run.

### 2. Environment

```bash
cp .env.example .env.local
# fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

The service role key is **server-only** — it's used by server components, API
routes, and the scripts. It never reaches the browser.

### 3. Install + demo data

```bash
npm install
npm run seed     # loads demo topics + 14 days of LG/Samsung data
npm run dev      # http://localhost:3000
```

### 4. Load your real ③ data (CSV)

Edit `data/owned_content.csv` (one `url` per line) and
`data/topic_whitelist.csv` (`tag`, optional `label`, `sort_order`), then:

```bash
npm run import
```

Re-running `import` upserts, so updating a CSV and re-running just refreshes the
rows.

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel → it autodetects Next.js.
3. Add the Supabase integration (or set `SUPABASE_URL` /
   `SUPABASE_SERVICE_ROLE_KEY` as env vars).
4. Deploy. Run the schema + your ingestion against the same Supabase project.

---

## Notes & caveats

- **Visibility is non-deterministic.** SEMrush AIO numbers swing day to day, so
  read trends/ranges, not single points. The demo seed adds jitter on purpose.
- **Total assumes non-overlapping topics.** SEMrush tags are hierarchical
  (`tv__non-brand` already contains `tv__non-brand__oled tv`). Keep the
  whitelist to one level or the Total will double-count. See
  `getTotalTimeSeries` in `src/lib/queries.ts`.
- **URL matching has one source of truth:** `src/lib/url-normalize.ts`. Both
  owned URLs and SEMrush cited URLs must pass through it before comparison.
- **Brand strings** (`LG` / `Samsung`) live in `src/config/brands.ts` and must
  match what your ingestion writes to `visibility_daily.brand`.

---

## Structure

```
src/
  app/
    page.tsx              dashboard (server component)
    layout.tsx
    globals.css
    api/agent/route.ts    agent scaffold (next phase)
  components/             Filters, TopicBrandChart, TotalTimeSeries, TopicAverageTable
  lib/                    supabase, queries, url-normalize, dates, types
  config/brands.ts
supabase/schema.sql
scripts/                  seed.ts, import-csv.ts
data/                     owned_content.csv, topic_whitelist.csv (you fill)
```
