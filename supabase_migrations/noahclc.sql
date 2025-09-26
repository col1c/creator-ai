insert into public.users_public (user_id)
select id from auth.users
on conflict (user_id) do nothing;

update public.users_public
set monthly_credit_limit = 50
where monthly_credit_limit is null or monthly_credit_limit <= 0;

update public.users_public
set monthly_credit_limit = 50
where user_id = (select id from auth.users where email = 'noahclc3@gmail.com' limit 1);
