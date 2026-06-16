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

// Splits a tag into the display hierarchy used by the table.
//   tv__non-brand                              -> { TV, "Total", "" }
//   tv__non-brand__oled tv                     -> { TV, "oled tv", "" }
//   tv__non-brand__tv size__65 inch tv         -> { TV, "tv size", "65 inch tv" }
//   ...deeper levels are joined into subtopic with " | ".
export interface TagParts {
  product: string;
  topic: string;
  subtopic: string;
  isTotal: boolean;
}

export function tagParts(tag: string): TagParts {
  const product = categoryOf(tag) ?? tag.split("__")[0];
  const segs = tag.split("__");
  const nbIdx = segs.indexOf("non-brand");
  const rest = nbIdx >= 0 ? segs.slice(nbIdx + 1) : segs.slice(1);
  if (rest.length === 0) return { product, topic: "Total", subtopic: "", isTotal: true };
  return {
    product,
    topic: rest[0],
    subtopic: rest.slice(1).join(" | "),
    isTotal: false,
  };
}
