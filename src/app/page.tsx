import Filters from "@/components/Filters";
import TopicBrandChart from "@/components/TopicBrandChart";
import CategoryTotals, { type CategorySeries } from "@/components/CategoryTotals";
import TopicAverageTable from "@/components/TopicAverageTable";
import { getTopicAverages, getTopicBrandDaily, getTopics } from "@/lib/queries";
import { BRANDS, BRAND_COLORS } from "@/config/brands";
import { daysAgo, safeDate, today } from "@/lib/dates";
import {
  CATEGORIES,
  CATEGORY_TOTAL_TAG,
  categoryOf,
  isCategory,
  type Category,
} from "@/lib/categories";
import type { DailyBrandPoint, Topic, TopicAverage } from "@/lib/types";

export const dynamic = "force-dynamic";

interface SearchParams {
  category?: string;
  topic?: string;
  start?: string;
  end?: string;
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return JSON.stringify(e);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const end = safeDate(searchParams.end, today());
  const start = safeDate(searchParams.start, daysAgo(13));
  const category: Category = isCategory(searchParams.category) ? searchParams.category : "TV";

  let topics: Topic[] = [];
  let categoryTopics: Topic[] = [];
  let selectedTopic = CATEGORY_TOTAL_TAG[category];
  let daily: DailyBrandPoint[] = [];
  let table: TopicAverage[] = [];
  const series: CategorySeries = {};
  let error: string | null = null;

  try {
    topics = await getTopics();

    const totalTag = CATEGORY_TOTAL_TAG[category];
    categoryTopics = topics
      .filter((t) => categoryOf(t.tag) === category)
      .sort((a, b) => (a.tag === totalTag ? -1 : b.tag === totalTag ? 1 : 0));

    selectedTopic =
      searchParams.topic && categoryTopics.some((t) => t.tag === searchParams.topic)
        ? searchParams.topic
        : totalTag;

    const [dailyRes, tableRes, ...catSeries] = await Promise.all([
      getTopicBrandDaily(selectedTopic, start, end),
      getTopicAverages(categoryTopics, start, end),
      ...CATEGORIES.map((c) => getTopicBrandDaily(CATEGORY_TOTAL_TAG[c], start, end)),
    ]);
    daily = dailyRes;
    table = tableRes;
    CATEGORIES.forEach((c, i) => {
      series[c] = catSeries[i];
    });
  } catch (e) {
    error = errMessage(e);
  }

  const selectedLabel =
    categoryTopics.find((t) => t.tag === selectedTopic)?.label ?? selectedTopic;

  return (
    <main className="app">
      <div className="topbar">
        <div>
          <h1 className="title">AI Visibility</h1>
          <p className="subtitle">
            Share of AI answers · {BRANDS.own} vs {BRANDS.competitor}
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
        </div>
      )}

      {!error && topics.length === 0 && (
        <div className="banner">
          <p className="banner__title">No topics loaded yet</p>
          <p>
            Load <code>data/topic_whitelist.csv</code> via <code>/api/admin/load</code>.
          </p>
        </div>
      )}

      <Filters
        allTopics={topics}
        category={category}
        selectedTopic={selectedTopic}
        start={start}
        end={end}
      />

      <div className="stack">
        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Total visibility by category</h2>
            <p className="card__sub">
              Each category&apos;s overall share, {start} → {end}
            </p>
          </div>
          <CategoryTotals series={series} />
        </section>

        <section className="card">
          <div className="card__head">
            <h2 className="card__title">Daily visibility — {selectedLabel}</h2>
            <p className="card__sub">
              {selectedTopic} · {start} → {end}
            </p>
          </div>
          <TopicBrandChart data={daily} />
        </section>

        <section className="card">
          <div className="card__head">
            <h2 className="card__title">{category} topics — average visibility</h2>
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
