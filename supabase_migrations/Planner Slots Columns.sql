-- Tabelle (falls noch nicht da – überspringen, wenn existiert)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- CREATE TABLE IF NOT EXISTS planner_slots (
--   id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
--   user_id uuid NOT NULL DEFAULT auth.uid(),
--   platform text NOT NULL,
--   scheduled_at timestamptz NOT NULL,
--   note text,
--   created_at timestamptz NOT NULL DEFAULT now()
-- );

-- RLS aktivieren
alter table planner_slots enable row level security;

-- Vorhandene Policies ggf. löschen (optional, wenn du Altlasten hast)
-- drop policy if exists planner_select_own on planner_slots;
-- drop policy if exists planner_insert_own on planner_slots;
-- drop policy if exists planner_update_own on planner_slots;
-- drop policy if exists planner_delete_own on planner_slots;

-- SELECT: eigene Zeilen lesen
create policy planner_select_own
on planner_slots
for select
using (auth.uid() = user_id);

-- INSERT: eigene Zeilen anlegen
create policy planner_insert_own
on planner_slots
for insert
with check (auth.uid() = user_id);

-- UPDATE: eigene Zeilen ändern (USING + WITH CHECK WICHTIG!)
create policy planner_update_own
on planner_slots
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- DELETE: eigene Zeilen löschen
create policy planner_delete_own
on planner_slots
for delete
using (auth.uid() = user_id);
