# AI Visibility Dashboard — SEMrush Enterprise AIO

Internal dashboard tracking **AI search visibility** (share of AI answers) for
**LG vs Samsung** across tracked topics, sourced from SEMrush Enterprise AIO.
Next.js (App Router) + Supabase Postgres, deployable on Vercel.

This is the **dashboard + data foundation + ingestion**. The analysis agent
(Phases 1–5) is scaffolded at `src/app/api/agent/route.ts` as the next phase.

---

## Deploy without a terminal (GitHub → Vercel) — recommended

You don't need a local machine. Everything is done in the browser.

1. **Push this repo to GitHub.**
2. **Supabase** (supabase.com): create a project → open **SQL Editor** → paste
   `supabase/schema.sql` → Run. Then Settings → **API Keys** → copy the Secret
   key (`sb_secret_...`) and your Project URL.
3. **Vercel**: import the GitHub repo (auto-detects Next.js).
4. **Env vars** — Vercel → Project → Settings → Environment Variables:
   ```
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   SEMRUSH_API_KEY, SEMRUSH_WORKSPACE_ID, SEMRUSH_PROJECT_ID, SEMRUSH_VISIBILITY_ELEMENT_ID
   CRON_SECRET            (any random string; lets Vercel Cron call the sync)
   ADMIN_TOKEN            (any random string; protects the loader routes)
   ```
   (Or add Supabase via the Vercel Marketplace integration — just confirm it
   injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.)
5. **Deploy.** Vercel runs install + build on its own servers.

### Load data — by opening URLs (no terminal)

- **Demo data** (to verify the UI): visit
  `https://YOUR-APP.vercel.app/api/admin/load?token=ADMIN_TOKEN&demo=1`
- **Your ③ CSVs**: commit your URLs to `data/owned_content.csv` and tags to
  `data/topic_whitelist.csv`, then visit
  `https://YOUR-APP.vercel.app/api/admin/load?token=ADMIN_TOKEN`
  (If it reports "file not found", `POST` the CSV text instead — see the route
  header comment.)
- **SEMrush visibility**: runs automatically every day via Vercel Cron
  (`vercel.json` → `/api/cron/sync`). Backfill a past day manually:
  `https://YOUR-APP.vercel.app/api/cron/sync?token=ADMIN_TOKEN&date=2026-06-10`

---

## What the dashboard shows

| Widget | Shows | Source table |
| --- | --- | --- |
| Daily visibility — selected topic | LG vs Samsung per day, for the chosen topic | `visibility_daily` |
| Total visibility | Prompt-weighted total across tracked topics, per day | `visibility_daily` |
| Filters | Topic + date range (drive the page via URL) | `topic_whitelist` |
| All topics — average | Mean visibility per topic, sorted by widest gap | `visibility_daily` |

## Data model

- **`visibility_daily`** — backbone, one row per (date, brand, tag). Filled by
  the daily sync (`/api/cron/sync` → SEMrush element `44d76a1d`).
- **`topic_whitelist`** — which tags to show/aggregate (CSV).
- **`owned_content`** — flat list of URLs you publish (CSV). The agent will use
  it to tell whether a cited source is yours.
- **`topic_citations`** — Phase 3 baseline (cited sources per topic). Schema is
  a starting point; adjust to the real element response when wiring it.

---

## Local dev (optional, if you do have a terminal)

```bash
cp .env.example .env.local      # fill in values
npm install
npm run seed                    # demo data  (= the ?demo=1 route)
npm run import                  # load data/*.csv  (= the loader route)
npm run dev                     # http://localhost:3000
```

---

## Notes & caveats

- **Visibility is non-deterministic** — read trends/ranges, not single points.
- **Total assumes non-overlapping topics.** SEMrush tags are hierarchical
  (`tv__non-brand` contains `tv__non-brand__oled tv`); whitelisting both
  double-counts. Keep the whitelist to one level. See `getTotalTimeSeries`.
- **URL matching has one source of truth:** `src/lib/url-normalize.ts`. Owned
  URLs and SEMrush cited URLs must both pass through it.
- **Brand strings** (`LG` / `Samsung`) live in `src/config/brands.ts` and must
  match `visibility_daily.brand`.
- The SEMrush sync mirrors your validated cURL exactly; it's untested against
  the live API from here, so check the first run's JSON response.

## Structure

```
src/
  app/
    page.tsx                  dashboard (server component)
    layout.tsx, globals.css
    api/
      cron/sync/route.ts      daily SEMrush -> visibility_daily
      admin/load/route.ts     load CSVs / demo from the browser
      agent/route.ts          agent scaffold (next phase)
  components/                 Filters, TopicBrandChart, TotalTimeSeries, TopicAverageTable
  lib/                        supabase, queries, semrush, url-normalize, dates, demo, types
  config/brands.ts
supabase/schema.sql
scripts/                      seed.ts, import-csv.ts (terminal equivalents)
data/                         owned_content.csv, topic_whitelist.csv (you fill)
vercel.json                   cron schedule
```
