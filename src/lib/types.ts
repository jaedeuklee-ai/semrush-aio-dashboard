// Shared types for the data layer and dashboard widgets.

// One row of the visibility_daily table (the Phase 1 backbone).
export interface VisibilityRow {
  date: string; // ISO date "YYYY-MM-DD"
  brand: string;
  tag: string;
  visibility: number | null; // prompts_mentioned / prompts (0..1)
  sov: number | null;
  avg_position: number | null;
  mentions: number | null;
  prompts: number | null;
  prompts_mentioned: number | null;
  unique_prompts: number | null;
}

export interface Topic {
  tag: string;
  label: string | null;
}

// Widget 1: per-date visibility for both brands, for one selected topic.
export interface DailyBrandPoint {
  date: string;
  LG: number | null;
  Samsung: number | null;
}

// Widget 2: per-date total visibility across all tracked topics.
export interface TotalPoint {
  date: string;
  LG: number | null;
  Samsung: number | null;
}

// Widget 4: average visibility per topic over the filtered period.
export interface TopicAverage {
  tag: string;
  label: string | null;
  lg: number | null;
  samsung: number | null;
  gap: number | null; // lg - samsung; positive = LG ahead
}

export interface DashboardData {
  topics: Topic[];
  selectedTopic: string;
  start: string;
  end: string;
  daily: DailyBrandPoint[];
  total: TotalPoint[];
  table: TopicAverage[];
  error: string | null;
}
