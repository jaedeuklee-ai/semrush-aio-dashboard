// Date helpers (UTC-based, ISO "YYYY-MM-DD").

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function today(): string {
  return isoDate(new Date());
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

// Validate a "YYYY-MM-DD" string; return fallback if invalid.
export function safeDate(value: string | undefined, fallback: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}
