// Brand configuration for Audio-only dashboard.

export const BRANDS = {
  own: "LG",
  competitor: "Samsung",

  // SEMrush ingestion brands
  ingest: ["LG", "Samsung", "ASUS", "JBL", "Sonos"],
} as const;

export type BrandKey = (typeof BRANDS.ingest)[number];

export const BRAND_COLORS: Record<string, string> = {
  LG: "#A50034",
  Samsung: "#1428A0",
  ASUS: "#00539B",
  JBL: "#FF6600",
  Sonos: "#222222",
};

// Audio category competitor mapping
export const COMPETITOR_BY_CATEGORY: Record<string, string> = {
  "Sound suite": "Sonos",
  speaker: "JBL",
};

export const DEFAULT_COMPETITOR = "Samsung";
