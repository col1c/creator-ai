-- 30_triggers_bootstrap.sql
-- Automatically create a users_public row for each new auth.users row.
-- Also includes a one-time backfill for existing users.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users_public (user_id, email)
  values (new.id, coalesce(new.email, null))
  on conflict (user_id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any missing rows in users_public for existing auth users.
insert into public.users_public (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;

-- Normalize monthly_credit_limit for all users (default to 50 if null or <= 0)
update public.users_public
set monthly_credit_limit = 50
where monthly_credit_limit is null or monthly_credit_limit <= 0;
