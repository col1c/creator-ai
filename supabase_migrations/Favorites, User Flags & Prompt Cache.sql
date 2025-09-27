-- generations: Favoriten
alter table public.generations
  add column if not exists favorite boolean default false;

-- users_public: E-Mail & Onboarding-Flag
alter table public.users_public
  add column if not exists email text,
  add column if not exists onboarding_done boolean default false;

-- prompt_cache für Caching
create table if not exists public.prompt_cache (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  cache_key text unique not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  output text not null,
  model text,
  tokens_in int default 0,
  tokens_out int default 0,
  created_at timestamptz default now()
);
alter table public.prompt_cache enable row level security;
do $$ begin
  create policy "own_cache"
    on public.prompt_cache
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
