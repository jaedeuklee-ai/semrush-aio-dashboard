"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BRANDS, BRAND_COLORS } from "@/config/brands";
import type { TotalPoint } from "@/lib/types";

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

export default function TotalTimeSeries({ data }: { data: TotalPoint[] }) {
  if (data.length === 0) {
    return <p className="empty">No data in the selected range.</p>;
  }

  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
          <defs>
            <linearGradient id="fillLG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND_COLORS[BRANDS.own]} stopOpacity={0.18} />
              <stop offset="100%" stopColor={BRAND_COLORS[BRANDS.own]} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillSA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND_COLORS[BRANDS.competitor]} stopOpacity={0.14} />
              <stop offset="100%" stopColor={BRAND_COLORS[BRANDS.competitor]} stopOpacity={0} />
            </linearGradient>
          </defs>
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
          <Area
            type="monotone"
            dataKey={BRANDS.own}
            stroke={BRAND_COLORS[BRANDS.own]}
            strokeWidth={2}
            fill="url(#fillLG)"
            connectNulls
          />
          <Area
            type="monotone"
            dataKey={BRANDS.competitor}
            stroke={BRAND_COLORS[BRANDS.competitor]}
            strokeWidth={2}
            fill="url(#fillSA)"
            connectNulls
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
