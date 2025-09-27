-- Falls nicht vorhanden:
create extension if not exists "uuid-ossp";

create table if not exists daily_ideas (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  idea text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_ideas_user_created on daily_ideas(user_id, created_at);

alter table daily_ideas enable row level security;

drop policy if exists ideas_select_own on daily_ideas;
drop policy if exists ideas_insert_own on daily_ideas;

create policy ideas_select_own
on daily_ideas
for select
using (auth.uid() = user_id);

create policy ideas_insert_own
on daily_ideas
for insert
with check (auth.uid() = user_id);
