/** Active SEMrush ingestion scope. Historical data is not changed by this filter. */
export const ACTIVE_INGEST_PARENT_TAGS = ["audio__non-brand"] as const;

export function isActiveIngestTag(tag: string): boolean {
  return ACTIVE_INGEST_PARENT_TAGS.some((parent) =>
    tag === parent || tag.startsWith(`${parent}__`),
  );
}
