-- 40_indexes.sql
-- Performance indexes for common filters and text search (via pg_trgm).

-- Generations: composite filter index (user, type, favorite, created_at)
create index if not exists gen_user_type_fav_created_idx
  on public.generations (user_id, type, favorite, created_at desc);

-- Generations: topic search (input->>'topic')
create index if not exists gen_topic_trgm_idx
  on public.generations using gin ( (lower(input->>'topic')) gin_trgm_ops );

-- Generations: output text search
create index if not exists gen_output_trgm_idx
  on public.generations using gin ( lower(output) gin_trgm_ops );
