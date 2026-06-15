-- ===========================================================================
-- SEMrush AIO dashboard — database schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Phase 1 backbone: per-day, per-brand, per-topic visibility.
-- Populated by your ingestion (SEMrush element 44d76a1d), once per day per
-- brand. visibility = prompts_mentioned / prompts.
-- ---------------------------------------------------------------------------
create table if not exists visibility_daily (
  date              date    not null,
  brand             text    not null,          -- 'LG' | 'Samsung'
  tag               text    not null,          -- e.g. 'tv__non-brand__oled tv'
  visibility        real,
  sov               real,
  avg_position      real,                       -- null when mentions = 0
  mentions          integer,
  prompts           integer,
  prompts_mentioned integer,
  unique_prompts    integer,
  primary key (date, brand, tag)
);

create index if not exists idx_visibility_tag       on visibility_daily (tag);
create index if not exists idx_visibility_date       on visibility_daily (date);
create index if not exists idx_visibility_tag_date   on visibility_daily (tag, date);

-- ---------------------------------------------------------------------------
-- Topic whitelist: which tags the dashboard shows / aggregates.
-- Loaded from data/topic_whitelist.csv via `npm run import`.
-- Keep these mutually exclusive (one level) so the Total widget doesn't
-- double-count overlapping parent/child tags.
-- ---------------------------------------------------------------------------
create table if not exists topic_whitelist (
  tag         text primary key,                 -- must match visibility_daily.tag
  label       text,                              -- optional display name
  sort_order  integer default 0
);

-- ---------------------------------------------------------------------------
-- Owned content: the flat set of URLs we publish.
-- Loaded from data/owned_content.csv via `npm run import`.
-- Used by the agent to answer "is this cited source ours?" — match a cited
-- URL by passing it through the SAME normalizeUrl() and looking it up here.
-- ---------------------------------------------------------------------------
create table if not exists owned_content (
  url_normalized  text primary key,             -- from src/lib/url-normalize.ts
  url             text not null,                -- original, for display
  domain          text,
  created_at      timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Phase 3 baseline: topic-level cited sources (SEMrush element 553cd819).
-- Batch-synced for whitelisted topics. NOTE: column shape below is a sensible
-- starting point — adjust it to match the actual element response when you
-- wire ingestion (regenerate "Get API Request" and inspect the JSON).
-- ---------------------------------------------------------------------------
create table if not exists topic_citations (
  date           date not null,
  tag            text not null,
  source_domain  text not null,
  source_url     text not null default '',       -- '' when only domain is known
  citations      integer,
  share          real,                           -- share of citations for the topic
  primary key (date, tag, source_domain, source_url)
);

create index if not exists idx_topic_citations_tag on topic_citations (tag);
