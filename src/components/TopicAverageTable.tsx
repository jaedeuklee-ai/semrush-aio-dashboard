import type { TopicAverage } from "@/lib/types";
import { BRANDS } from "@/config/brands";

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
    return <p className="empty">No topics in the whitelist yet — load topic_whitelist.csv.</p>;
  }

  // Surface the biggest weaknesses first (most negative gap = LG furthest behind).
  const sorted = [...rows].sort((a, b) => {
    const ga = a.gap ?? Number.POSITIVE_INFINITY;
    const gb = b.gap ?? Number.POSITIVE_INFINITY;
    return ga - gb;
  });

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Topic</th>
          <th>{BRANDS.own} avg</th>
          <th>{BRANDS.competitor} avg</th>
          <th>Gap (LG − Samsung)</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.tag}>
            <td>
              {r.label && <span className="topic-label">{r.label} </span>}
              <span className="topic-tag">{r.tag}</span>
            </td>
            <td className="num">{pct(r.lg)}</td>
            <td className="num">{pct(r.samsung)}</td>
            <td>{gapCell(r.gap)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
