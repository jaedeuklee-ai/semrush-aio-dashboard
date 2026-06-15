import { BRANDS } from "../config/brands";

// Demo topics — mutually exclusive (no parent/child overlap) so the Total
// widget stays correct. Values mirror the real sample: LG leads on TV, trails
// on IT (monitors) and Audio.
export const DEMO_TOPICS = [
  { tag: "tv__non-brand", label: "TV", lg: 0.88, samsung: 0.8, prompts: 2788 },
  { tag: "it__non-brand", label: "IT / Monitors", lg: 0.586, samsung: 0.72, prompts: 1580 },
  { tag: "audio__non-brand", label: "Audio", lg: 0.15, samsung: 0.55, prompts: 500 },
];

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Deterministic jitter so demo data looks like real (non-deterministic) AI data.
function jitter(base: number, day: number, salt: number): number {
  return Math.min(1, Math.max(0, base + Math.sin(day * 1.3 + salt) * 0.05));
}

export function buildDemoWhitelist() {
  return DEMO_TOPICS.map((t, i) => ({ tag: t.tag, label: t.label, sort_order: i }));
}

export function buildDemoVisibility(days = 14): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = isoDaysAgo(d);
    DEMO_TOPICS.forEach((t, ti) => {
      for (const [brand, base, salt] of [
        [BRANDS.own, t.lg, ti],
        [BRANDS.competitor, t.samsung, ti + 10],
      ] as const) {
        const visibility = Number(jitter(base, d, salt).toFixed(4));
        const prompts = t.prompts;
        const prompts_mentioned = Math.round(visibility * prompts);
        rows.push({
          date,
          brand,
          tag: t.tag,
          visibility,
          sov: Number((visibility * 0.7).toFixed(4)),
          avg_position: Number((1 + (1 - visibility) * 4).toFixed(2)),
          mentions: Math.round(prompts_mentioned * 1.5),
          prompts,
          prompts_mentioned,
          unique_prompts: Math.round(prompts / 4),
        });
      }
    });
  }
  return rows;
}
