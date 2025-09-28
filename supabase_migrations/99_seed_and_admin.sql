-- 99_seed_and_admin.sql
-- Convenience seed/fixes. Safe to run multiple times.

-- Ensure credits default to 50 if missing or invalid.
update public.users_public
set monthly_credit_limit = 50
where monthly_credit_limit is null or monthly_credit_limit <= 0;

-- OPTIONAL: set a specific user's credit limit by email (adjust as needed).
-- update public.users_public
-- set monthly_credit_limit = 50
-- where user_id = (select id from auth.users where email = 'user@example.com' limit 1);
