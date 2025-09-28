-- 20_rls_policies.sql
-- Enable Row Level Security and define concise policies.
-- Safe to re-run: drop-if-exists is used before create.

-- Enable RLS
alter table public.users_public enable row level security;
alter table public.generations enable row level security;
alter table public.templates enable row level security;
alter table public.usage_log enable row level security;

-- USERS_PUBLIC policies
drop policy if exists "users_public me_read"   on public.users_public;
drop policy if exists "users_public me_upsert" on public.users_public;
drop policy if exists "users_public me_update" on public.users_public;

create policy "users_public me_read"
  on public.users_public for select
  using (auth.uid() = user_id);

create policy "users_public me_upsert"
  on public.users_public for insert
  with check (auth.uid() = user_id);

create policy "users_public me_update"
  on public.users_public for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- GENERATIONS policies
drop policy if exists "gen own_select" on public.generations;
drop policy if exists "gen own_insert" on public.generations;
drop policy if exists "gen own_update" on public.generations;
drop policy if exists "gen own_delete" on public.generations;

create policy "gen own_select"
  on public.generations for select
  using (auth.uid() = user_id);

create policy "gen own_insert"
  on public.generations for insert
  with check (auth.uid() = user_id);

create policy "gen own_update"
  on public.generations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "gen own_delete"
  on public.generations for delete
  using (auth.uid() = user_id);

-- TEMPLATES policies
drop policy if exists "tpl own_all" on public.templates;

create policy "tpl own_all"
  on public.templates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- USAGE_LOG policies
drop policy if exists "usage own_read"   on public.usage_log;
drop policy if exists "usage own_insert" on public.usage_log;

create policy "usage own_read"
  on public.usage_log for select
  using (auth.uid() = user_id);

create policy "usage own_insert"
  on public.usage_log for insert
  with check (auth.uid() = user_id);
