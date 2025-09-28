-- Tabelle
create table if not exists usage_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  event text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- Indexe (optional, aber sinnvoll)
create index if not exists idx_usage_events_user_created on usage_events(user_id, created_at);
create index if not exists idx_usage_events_event on usage_events(event);

-- RLS
alter table usage_events enable row level security;

drop policy if exists usage_select_own on usage_events;
drop policy if exists usage_insert_own on usage_events;

create policy usage_select_own
on usage_events
for select
using (auth.uid() = user_id);

create policy usage_insert_own
on usage_events
for insert
with check (auth.uid() = user_id);
