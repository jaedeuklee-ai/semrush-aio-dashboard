// Maps the SEMrush tag hierarchy to the 3 top-level categories shown in the
// dashboard. Derived purely from the tag prefix — no extra data needed.

export const CATEGORIES = ["TV", "Audio", "Monitor"] as const;
export type Category = (typeof CATEGORIES)[number];

// The "Total" tag for each category (the top-level roll-up row).
export const CATEGORY_TOTAL_TAG: Record<Category, string> = {
  TV: "tv__non-brand",
  Audio: "audio__non-brand",
  Monitor: "it__non-brand",
};

export function categoryOf(tag: string): Category | null {
  if (tag.startsWith("tv__")) return "TV";
  if (tag.startsWith("audio__")) return "Audio";
  if (tag.startsWith("it__")) return "Monitor";
  return null;
}

export function isCategory(value: string | undefined | null): value is Category {
  return value === "TV" || value === "Audio" || value === "Monitor";
}
