-- prüfe Spalten
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='prompt_cache'
order by column_name;

-- prüfen, ob Policy greift (als normaler User)
select * from public.prompt_cache limit 1;