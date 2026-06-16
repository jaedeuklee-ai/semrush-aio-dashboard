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
-- Filled by /api/cron/citations, which loops the topic_whitelist and stamps
-- (date, tag) onto each row (the topic comes from the CBF_tags request filter,
-- not the response). domain_type is SEMrush's channel class:
-- Owned | Earned | Social | Other.
-- ---------------------------------------------------------------------------
drop table if exists topic_citations;
create table topic_citations (
  date                  date    not null,
  tag                   text    not null,   -- from the request (CBF_tags)
  source_url            text    not null,   -- the cited URL
  domain                text,                -- derived from source_url
  domain_type           text,                -- Owned | Earned | Social | Other
  citation_share        real,
  mentions              integer,
  mentions_diff         integer,
  position              real,
  prompts_with_citation integer,
  total_citations       integer,
  total_responses       integer,
  primary key (date, tag, source_url)
);

create index if not exists idx_topic_citations_tag  on topic_citations (tag);
create index if not exists idx_topic_citations_date on topic_citations (date);

-- ---------------------------------------------------------------------------
-- Backfill progress (used by the self-chaining backfill in /api/cron/*).
-- One row per job: 'visibility' | 'citations'. Lets you poll ?status=1.
-- ---------------------------------------------------------------------------
create table if not exists sync_state (
  job        text primary key,            -- 'visibility' | 'citations'
  end_date   date,                         -- target end of the current backfill
  last_done  date,                         -- last day successfully processed
  status     text,                         -- running | complete | error | stalled
  message    text,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Prompt-level layer (path A). prompt_map is user-provided (tag, prompt)
-- pairs; the loader fills the other three from SEMrush.
-- ---------------------------------------------------------------------------
create table if not exists prompt_map (
  tag        text not null,
  prompt     text not null,
  updated_at timestamptz default now(),
  primary key (tag, prompt)
);

create table if not exists prompt_brands (
  tag             text not null,
  prompt          text not null,
  brands_list     jsonb,
  brands_amount   integer,
  volume          integer,
  lg_present      boolean,
  samsung_present boolean,
  models          jsonb,
  updated_at      timestamptz default now(),
  primary key (tag, prompt)
);

create table if not exists prompt_citations (
  tag          text not null,
  prompt       text not null,
  source_url   text not null,
  source_title text,
  citations    integer,
  latest_date  date,
  updated_at   timestamptz default now(),
  primary key (tag, prompt, source_url)
);

create table if not exists prompt_fanout (
  tag        text not null,
  prompt     text not null,
  query      text not null,
  count      integer,
  updated_at timestamptz default now(),
  primary key (tag, prompt, query)
);
