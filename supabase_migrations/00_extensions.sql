-- 00_extensions.sql
-- Ensure useful extensions exist (Supabase allows extensions in the "extensions" schema).
create extension if not exists pg_trgm with schema extensions;