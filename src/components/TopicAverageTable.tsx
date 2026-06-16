import type { TopicAverage } from "@/lib/types";
import { BRANDS } from "@/config/brands";
import { tagParts } from "@/lib/categories";

function pct(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

function gapCell(gap: number | null) {
  if (gap == null) return <span className="gap-zero num">—</span>;
  const label = `${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1)} pt`;
  if (gap > 0.005) return <span className="gap-pos num">{label}</span>;
  if (gap < -0.005) return <span className="gap-neg num">{label}</span>;
  return <span className="gap-zero num">{label}</span>;
}

export default function TopicAverageTable({ rows }: { rows: TopicAverage[] }) {
  if (rows.length === 0) {
    return <p className="empty">No data for this category in the selected range.</p>;
  }

  // Total row(s) pinned to the top; the rest sorted by widest gap (LG behind).
  const decorated = rows.map((r) => ({ r, parts: tagParts(r.tag) }));
  decorated.sort((a, b) => {
    if (a.parts.isTotal !== b.parts.isTotal) return a.parts.isTotal ? -1 : 1;
    const ga = a.r.gap ?? Number.POSITIVE_INFINITY;
    const gb = b.r.gap ?? Number.POSITIVE_INFINITY;
    return ga - gb;
  });

  return (
    <table className="table">
      <thead>
        <tr>
          <th className="left">Product</th>
          <th className="left">Topic</th>
          <th className="left">Sub Topic</th>
          <th>{BRANDS.own} avg</th>
          <th>{BRANDS.competitor} avg</th>
          <th>Gap (LG − Samsung)</th>
        </tr>
      </thead>
      <tbody>
        {decorated.map(({ r, parts }) => (
          <tr key={r.tag} className={parts.isTotal ? "total-row" : undefined}>
            <td className="left">{parts.product}</td>
            <td className="left">{parts.topic}</td>
            <td className="left topic-tag">{parts.subtopic || "—"}</td>
            <td className="num">{pct(r.lg)}</td>
            <td className="num">{pct(r.samsung)}</td>
            <td>{gapCell(r.gap)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
