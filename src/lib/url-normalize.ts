// Single source of truth for URL normalization.
//
// Both your owned-content URLs (from the CSV) and the cited-source URLs that
// SEMrush returns MUST pass through this exact function before they are
// compared, or the "is this cited source ours?" join will silently miss.
//
// Rules applied:
//   - add https:// if no scheme is present
//   - drop the scheme entirely (http/https treated as equal)
//   - lowercase the host and strip a leading "www."
//   - strip query string (?...) and hash (#...)
//   - strip trailing slashes from the path
//
// NOTE: the path case is preserved, because URL paths are technically
// case-sensitive. If you find SEMrush returns cited URLs with different path
// casing than your owned URLs, lowercase the path here too — but change it in
// THIS ONE place so both sides stay consistent.

export interface NormalizedUrl {
  normalized: string; // e.g. "lg.com/us/tvs/oled"
  domain: string; // e.g. "lg.com"
}

export function normalizeUrl(input: string): NormalizedUrl | null {
  if (!input) return null;

  let raw = input.trim();
  if (raw === "") return null;
  if (!/^https?:\/\//i.test(raw)) {
    raw = "https://" + raw;
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  const domain = u.hostname.replace(/^www\./i, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, ""); // strip trailing slashes
  const normalized = domain + path;

  return { normalized, domain };
}
