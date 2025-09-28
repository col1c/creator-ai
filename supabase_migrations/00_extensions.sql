-- 00_extensions.sql
-- Ensure required extensions (Supabase installs them into the "extensions" schema).
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
