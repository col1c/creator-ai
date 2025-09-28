-- 55_prompt_cache.sql
-- Canonical prompt cache table (idempotent).

create table if not exists public.prompt_cache (
  cache_key text primary key, -- sha256(user_id|type|normalized_payload)
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('hook','script','caption','hashtags')),
  payload jsonb not null,     -- canonicalized (sorted keys, trimmed)
  output text not null,       -- cached text
  model text,
  tokens_in int,
  tokens_out int,
  created_at timestamptz default now()
);

alter table public.prompt_cache enable row level security;

drop policy if exists "cache own_read" on public.prompt_cache;
drop policy if exists "cache own_write" on public.prompt_cache;

create policy "cache own_read"
  on public.prompt_cache for select
  using (auth.uid() = user_id);

create policy "cache own_write"
  on public.prompt_cache for insert
  with check (auth.uid() = user_id);

create index if not exists prompt_cache_user_type_key_idx
  on public.prompt_cache (user_id, type);
