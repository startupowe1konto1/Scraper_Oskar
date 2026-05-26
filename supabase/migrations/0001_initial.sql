-- Shoppalyzer initial schema
-- Compatible with Supabase (uses auth.users) and standalone Postgres
-- Run via: psql $DATABASE_URL -f 0001_initial.sql
-- Or via Supabase SQL editor (paste and execute)

-- ─── Extensions ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─── Enums ──────────────────────────────────────────────────────────────────
do $$ begin
  create type plan_tier as enum ('free', 'pro', 'enterprise');
exception when duplicate_object then null; end $$;

do $$ begin
  create type query_status as enum (
    'queued', 'discovering', 'scraping', 'parsing', 'analyzing', 'completed', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type input_type as enum ('allegro_url', 'ean', 'product_url', 'auto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type archetype_code as enum (
    'VOLUME_DRIVEN', 'PAY_TO_PLAY', 'BADGE_DRIVEN',
    'PRICE_THRESHOLD', 'PRICE_TIERED', 'MIXED', 'UNKNOWN'
  );
exception when duplicate_object then null; end $$;

-- ─── Users ──────────────────────────────────────────────────────────────────
-- On Supabase: auth.users provides id + email; we extend with our own profile data.
-- On standalone Postgres: define users table fully.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  plan plan_tier not null default 'free',
  monthly_queries_used int not null default 0,
  monthly_queries_limit int not null default 1,   -- free tier: 1/month
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create profile when a user signs up via Supabase Auth
-- (Comment out on standalone Postgres if not using Supabase auth)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Queries ─────────────────────────────────────────────────────────────────
-- Each user request to analyze a product becomes a row here.
create table if not exists public.queries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- What the user submitted
  input text not null,
  input_type input_type not null default 'auto',
  context jsonb,            -- optional metadata (seller_ref, display_name, etc.)

  -- Resolved during 'discovering' phase
  ean text,
  product_url text,
  product_name text,
  ocoi_token text,

  -- Status tracking
  status query_status not null default 'queued',
  status_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Failure tracking
  error_code text,
  error_message text,
  error_retryable boolean,

  -- Batch support (CSV uploads)
  batch_id uuid,
  batch_label text
);

create index if not exists idx_queries_user_status on public.queries(user_id, status);
create index if not exists idx_queries_user_created on public.queries(user_id, created_at desc);
create index if not exists idx_queries_batch on public.queries(batch_id) where batch_id is not null;
create index if not exists idx_queries_status_queued on public.queries(status) where status = 'queued';

-- ─── Scrape jobs ────────────────────────────────────────────────────────────
-- One row per Firecrawl call made for a query. Tracks credit spend per scrape.
create table if not exists public.scrape_jobs (
  id uuid primary key default uuid_generate_v4(),
  query_id uuid not null references public.queries(id) on delete cascade,

  step text not null,            -- 'search', 'offers_aggregator', 'per_offer_detail'
  url text not null,
  status text not null default 'pending',    -- pending|running|succeeded|failed
  firecrawl_key_name text,
  credits_used int not null default 0,
  raw_html_path text,            -- supabase storage path for cached HTML

  started_at timestamptz,
  finished_at timestamptz,
  error_message text
);

create index if not exists idx_scrape_jobs_query on public.scrape_jobs(query_id);

-- ─── Offers ─────────────────────────────────────────────────────────────────
-- Parsed seller data from the offers aggregator. One row per seller listing.
create table if not exists public.offers (
  id uuid primary key default uuid_generate_v4(),
  query_id uuid not null references public.queries(id) on delete cascade,

  -- Allegro identity
  offer_id text not null,
  seller text,
  title text,
  offer_url text,

  -- Pricing
  price numeric(10, 2),
  total_with_delivery numeric(10, 2),

  -- Trust signals
  recommend_pct numeric(5, 2),
  reviews int,
  sold_recent int default 0,

  -- Badges (single jsonb column for flexibility)
  badges jsonb not null default '{}',     -- { smart, super_seller, top_offer, contains_promo, sponsored, firma, official_store }

  -- Delivery
  delivery_raw text,            -- 'w sobotę', 'za 5 dni', etc.

  created_at timestamptz not null default now()
);

create index if not exists idx_offers_query on public.offers(query_id);
create unique index if not exists idx_offers_offerid on public.offers(query_id, offer_id);

-- ─── Analyses ────────────────────────────────────────────────────────────────
-- The recommendation engine output. One per completed query.
create table if not exists public.analyses (
  id uuid primary key default uuid_generate_v4(),
  query_id uuid not null unique references public.queries(id) on delete cascade,

  -- Archetype classification
  archetype archetype_code not null,
  archetype_confidence text not null,            -- 'LOW' | 'MEDIUM' | 'HIGH'
  archetype_reasoning text,
  archetype_playbook text,

  -- Market summary (denormalized for fast dashboard reads)
  market_summary jsonb not null,

  -- Per-seller recommendations (large json blob, indexed by seller name)
  recommendations jsonb not null default '[]',

  -- User-seller-specific verdict (if user identified their own listing)
  user_seller_verdict jsonb,

  generated_at timestamptz not null default now()
);

-- ─── Monitors (recurring re-scrapes) ─────────────────────────────────────────
create table if not exists public.monitors (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  product_url text not null,
  display_name text,
  frequency text not null default 'weekly',     -- 'daily' | 'weekly' | 'monthly'

  last_run_at timestamptz,
  last_state_hash text,      -- compare to detect changes
  next_run_at timestamptz,
  active boolean not null default true,

  created_at timestamptz not null default now()
);

create index if not exists idx_monitors_user_active on public.monitors(user_id, active);
create index if not exists idx_monitors_next_run on public.monitors(next_run_at) where active = true;

-- ─── PDF artifacts ───────────────────────────────────────────────────────────
-- Tracking generated PDF reports (stored in Supabase Storage)
create table if not exists public.pdf_artifacts (
  id uuid primary key default uuid_generate_v4(),
  query_id uuid not null references public.queries(id) on delete cascade,
  template text not null,        -- 'editorial' | 'compact' | 'seller_summary'
  storage_path text not null,    -- path in supabase storage bucket
  size_bytes int,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Each user only sees their own data. (Supabase-specific; works alongside auth.)
alter table public.profiles enable row level security;
alter table public.queries enable row level security;
alter table public.scrape_jobs enable row level security;
alter table public.offers enable row level security;
alter table public.analyses enable row level security;
alter table public.monitors enable row level security;
alter table public.pdf_artifacts enable row level security;

-- Profile: users can read/update their own
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- Queries: users see only their own
create policy "queries_self_read" on public.queries
  for select using (auth.uid() = user_id);
create policy "queries_self_insert" on public.queries
  for insert with check (auth.uid() = user_id);
create policy "queries_self_update" on public.queries
  for update using (auth.uid() = user_id);

-- Related tables: filtered via the parent query
create policy "scrape_jobs_via_query" on public.scrape_jobs
  for select using (exists (
    select 1 from public.queries q where q.id = scrape_jobs.query_id and q.user_id = auth.uid()
  ));
create policy "offers_via_query" on public.offers
  for select using (exists (
    select 1 from public.queries q where q.id = offers.query_id and q.user_id = auth.uid()
  ));
create policy "analyses_via_query" on public.analyses
  for select using (exists (
    select 1 from public.queries q where q.id = analyses.query_id and q.user_id = auth.uid()
  ));
create policy "pdf_artifacts_via_query" on public.pdf_artifacts
  for select using (exists (
    select 1 from public.queries q where q.id = pdf_artifacts.query_id and q.user_id = auth.uid()
  ));

-- Monitors: users see only their own
create policy "monitors_self_read" on public.monitors
  for select using (auth.uid() = user_id);
create policy "monitors_self_insert" on public.monitors
  for insert with check (auth.uid() = user_id);
create policy "monitors_self_update" on public.monitors
  for update using (auth.uid() = user_id);
create policy "monitors_self_delete" on public.monitors
  for delete using (auth.uid() = user_id);

-- ─── Service role bypass ─────────────────────────────────────────────────────
-- Workers running on the server with service_role key bypass RLS automatically.
-- No additional policies needed for that path.

-- ─── Indexes for common queries ─────────────────────────────────────────────
create index if not exists idx_offers_seller_query on public.offers(seller, query_id);
create index if not exists idx_offers_sold on public.offers(query_id, sold_recent desc);
create index if not exists idx_analyses_query on public.analyses(query_id);

-- ─── Helper view: queries with their analysis result ───────────────────────
create or replace view public.queries_with_results as
  select
    q.*,
    a.archetype,
    a.archetype_confidence,
    a.market_summary,
    a.generated_at as analysis_generated_at
  from public.queries q
  left join public.analyses a on a.query_id = q.id;

grant select on public.queries_with_results to authenticated;
