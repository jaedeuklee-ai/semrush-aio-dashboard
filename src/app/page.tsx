import Filters from "@/components/Filters";
import TopicBrandChart from "@/components/TopicBrandChart";
import TotalTimeSeries from "@/components/TotalTimeSeries";
import TopicAverageTable from "@/components/TopicAverageTable";
import {
  getTopicAverages,
  getTopicBrandDaily,
  getTopics,
  getTotalTimeSeries,
} from "@/lib/queries";
import { BRANDS, BRAND_COLORS } from "@/config/brands";
import { daysAgo, safeDate, today } from "@/lib/dates";
import type { DailyBrandPoint, Topic, TopicAverage, TotalPoint } from "@/lib/types";

// Always read fresh from the DB.
export const dynamic = "force-dynamic";

interface SearchParams {
  topic?: string;
  start?: string;
  end?: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const end = safeDate(searchParams.end, today());
  const start = safeDate(searchParams.start, daysAgo(13)); // ~2 weeks

  let topics: Topic[] = [];
  let daily: DailyBrandPoint[] = [];
  let total: TotalPoint[] = [];
  let table: TopicAverage[] = [];
  let error: string | null = null;
  let selectedTopic = "";

  try {
    topics = await getTopics();
    selectedTopic = searchParams.topic && topics.some((t) => t.tag === searchParams.topic)
      ? searchParams.topic
      : topics[0]?.tag ?? "";

    if (selectedTopic) {
      [daily, total, table] = await Promise.all([
        getTopicBrandDaily(selectedTopic, start, end),
        getTotalTimeSeries(start, end),
        getTopicAverages(start, end),
      ]);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <main className="app">
      <div className="topbar">
        <div>
          <h1 className="title">AI Visibility</h1>
          <p className="subtitle">
            Share of AI answers across tracked topics · {BRANDS.own} vs {BRANDS.competitor}
          </p>
        </div>
        <div className="legend">
          <span>
            <span className="legend__dot" style={{ background: BRAND_COLORS[BRANDS.own] }} />
            {BRANDS.own}
          </span>
          <span>
            <span
              className="legend__dot"
              style={{ background: BRAND_COLORS[BRANDS.competitor] }}
            />
            {BRANDS.competitor}
          </span>
        </div>
      </div>

      {error && (
        <div className="banner">
          <p className="banner__title">Couldn&apos;t load data</p>
          <p>{error}</p>
          <p style={{ marginTop: 8 }}>
            First run? Set <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
            <code>.env.local</code>, run the schema in <code>supabase/schema.sql</code>, then{" "}
            <code>npm run seed</code> for demo data.
          </p>
        </div>
      )}

      <Filters topics={topics} selectedTopic={selectedTopic} start={start} end={end} />

      {!error && topics.length === 0 && (
        <div className="banner">
          <p className="banner__title">No topics loaded yet</p>
          <p>
            Add tags to <code>data/topic_whitelist.csv</code> and run <code>npm run import</code>,
            or <code>npm run seed</code> to load demo data.
          </p>
        </div>
      )}

      <div className="grid">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Daily visibility — selected topic</h2>
            <p className="card__sub">
              {selectedTopic || "—"} · {start} → {end}
            </p>
          </div>
          <TopicBrandChart data={daily} />
        </section>

        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Total visibility</h2>
            <p className="card__sub">Prompt-weighted across all tracked topics</p>
          </div>
          <TotalTimeSeries data={total} />
        </section>

        <section className="card card--wide">
          <div className="card__head">
            <h2 className="card__title">All topics — average visibility</h2>
            <p className="card__sub">
              Mean over {start} → {end}. Sorted by widest gap where {BRANDS.own} trails.
            </p>
          </div>
          <TopicAverageTable rows={table} />
        </section>
      </div>
    </main>
  );
}
