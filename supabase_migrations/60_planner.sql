-- 60_planner.sql
-- Optional planner feature (Option B). Includes FK to users_public and RLS.

-- Planner table (UTC timestamps recommended)
create table if not exists public.planner_slots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('tiktok','instagram','youtube','shorts','reels','other')),
  scheduled_at timestamptz not null,
  generation_id bigint references public.generations(id) on delete set null,
  note text,
  reminder_sent boolean default false,
  created_at timestamptz default now()
);

-- Also keep a FK to users_public for convenient joins (and cascade behavior)
do $$ begin
  alter table public.planner_slots
    add constraint planner_slots_user_public_fk
    foreign key (user_id) references public.users_public(user_id) on delete cascade;
exception when duplicate_object then
  null;
end $$;

-- RLS & policies
alter table public.planner_slots enable row level security;

drop policy if exists "planner own_read"   on public.planner_slots;
drop policy if exists "planner own_write"  on public.planner_slots;
drop policy if exists "planner own_delete" on public.planner_slots;

create policy "planner own_read"
  on public.planner_slots for select
  using (auth.uid() = user_id);

create policy "planner own_write"
  on public.planner_slots for insert
  with check (auth.uid() = user_id);

create policy "planner own_delete"
  on public.planner_slots for delete
  using (auth.uid() = user_id);
