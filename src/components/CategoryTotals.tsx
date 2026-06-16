import TopicBrandChart from "./TopicBrandChart";
import { CATEGORIES } from "@/lib/categories";
import type { DailyBrandPoint } from "@/lib/types";

export type CategorySeries = Record<string, DailyBrandPoint[]>;

export default function CategoryTotals({ series }: { series: CategorySeries }) {
  return (
    <div className="minis">
      {CATEGORIES.map((cat) => (
        <div key={cat} className="mini">
          <p className="mini__title">{cat}</p>
          <TopicBrandChart data={series[cat] ?? []} height={200} />
        </div>
      ))}
    </div>
  );
}
