"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BRANDS, BRAND_COLORS } from "@/config/brands";
import type { DailyBrandPoint } from "@/lib/types";

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

export default function TopicBrandChart({
  data,
  height = 280,
}: {
  data: DailyBrandPoint[];
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="empty">No data for this topic in the selected range.</p>;
  }

  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="var(--line-2)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickFormatter={(d: string) => d.slice(5)}
            stroke="var(--line)"
          />
          <YAxis
            domain={[0, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            stroke="var(--line)"
            width={44}
          />
          <Tooltip
            formatter={(v: number, name: string) => [pct(v), name]}
            labelStyle={{ color: "var(--ink)" }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid var(--line)" }}
          />
          <Line
            type="monotone"
            dataKey={BRANDS.own}
            stroke={BRAND_COLORS[BRANDS.own]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey={BRANDS.competitor}
            stroke={BRAND_COLORS[BRANDS.competitor]}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
