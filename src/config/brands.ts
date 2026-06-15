// Brand configuration.
// `own` and `competitor` are the exact string values stored in
// visibility_daily.brand (they must match what your ingestion writes).
// Colors are the actual brand hues so that color itself encodes which
// brand a series belongs to, consistently across every chart and table.

export const BRANDS = {
  own: "LG",
  competitor: "Samsung",
} as const;

export type BrandKey = (typeof BRANDS)[keyof typeof BRANDS];

export const BRAND_COLORS: Record<string, string> = {
  [BRANDS.own]: "#A50034", // LG red
  [BRANDS.competitor]: "#1428A0", // Samsung blue
};
