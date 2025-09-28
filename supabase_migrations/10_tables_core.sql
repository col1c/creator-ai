-- 10_tables_core.sql
-- Core tables required by the app (public schema). Idempotent and with sane defaults.

-- Users public profile (1 row per auth user)
create table if not exists public.users_public (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text,
  niche text,
  target text,
  email text,                                  -- optional, used by planner reminders
  brand_voice jsonb default '{}'::jsonb,
  monthly_credit_limit int default 50,
  onboarding_done boolean not null default false,
  created_at timestamptz default now()
);

-- Generated content (Library)
create table if not exists public.generations (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text check (type in ('hook','script','caption','hashtags')) not null,
  input jsonb not null,             -- { topic, niche, tone, ... }
  output text not null,             -- single selected variant/text
  favorite boolean not null default false,
  created_at timestamptz default now()
);

-- Optional: Templates (can be used later for CRUD templates)
create table if not exists public.templates (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text check (type in ('hook','script','caption')) not null,
  prompt jsonb not null,
  created_at timestamptz default now()
);

-- Usage log (credits/stats)
create table if not exists public.usage_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event text not null,          -- 'generate' | 'save' | 'login' | ...
  meta jsonb,
  created_at timestamptz default now()
);
