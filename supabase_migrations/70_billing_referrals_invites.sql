-- 70_billing_referrals_invites.sql
-- Billing/Plan fields + Invites & Referrals. Requires pgcrypto (gen_random_uuid).

-- users_public: billing & referrals fields
alter table public.users_public
  add column if not exists plan text default 'free',                -- 'free' | 'pro' | 'team'
  add column if not exists invited boolean default false,
  add column if not exists referral_code text unique,
  add column if not exists referred_by text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_status text,
  add column if not exists pro_until timestamptz;

-- one-time referral_code backfill (short & human-readable)
update public.users_public
set referral_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
where referral_code is null;

-- Invites
create table if not exists public.invites (
  code text primary key,
  created_by uuid references auth.users(id) on delete cascade,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  used_at timestamptz
);
alter table public.invites enable row level security;

-- Referrals (who invited whom)
create table if not exists public.referrals (
  id bigint generated always as identity primary key,
  referrer_user_id uuid references auth.users(id) on delete cascade,
  referred_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);
alter table public.referrals enable row level security;

-- Policies: invites readable by creator; inserts/updates via service-role
drop policy if exists "inv own_read" on public.invites;
create policy "inv own_read" on public.invites
  for select using (auth.uid() = created_by);

-- Policies: referrals readable by both parties
drop policy if exists "ref own_read" on public.referrals;
create policy "ref own_read" on public.referrals
  for select using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id);
