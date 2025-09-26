# Supabase migrations (Creator AI)

## Files & order
1. `00_extensions.sql` – installs `pg_trgm` (in `extensions` schema).
2. `10_tables_core.sql` – creates core tables (`users_public`, `generations`, `templates`, `usage_log`).
3. `20_rls_policies.sql` – enables RLS and defines all policies.
4. `30_triggers_bootstrap.sql` – trigger to auto-create `users_public` + backfill + normalize limits.
5. `40_indexes.sql` – performance indexes (GIN trigram + composite).
6. `60_planner.sql` – optional Planner table + RLS (Option B).
7. `99_seed_and_admin.sql` – optional fixes/seeds.

## Apply
Using Supabase SQL editor or psql in this exact order. Example (psql):

```bash
for f in 00_extensions 10_tables_core 20_rls_policies 30_triggers_bootstrap 40_indexes 60_planner 99_seed_and_admin; do
  psql "$SUPABASE_DB_URL" -f $f.sql
done
```

All scripts are idempotent and can be re-run safely.
