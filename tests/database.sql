-- ONLY for an empty disposable PostgreSQL database. Stubs emulate Supabase JWT helpers.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb $$;
grant usage on schema auth to authenticated;
grant execute on all functions in schema auth to authenticated;
\ir ../supabase/migrations/202609300001_consult_core.sql
\ir ../supabase/migrations/202610010001_consult_apply_import.sql
set role authenticated;
select set_config('test.uid','00000000-0000-0000-0000-000000000001',false);
select set_config('test.jwt','{"app_metadata":{"z_consult":true}}',false);
do $$ declare first_id uuid; second_id uuid; begin
 first_id := consult.stage_import('synthetic.xlsx',repeat('a',64),'sheet','v1','[{"key":"3","externalId":"123","name":"synthetic","consultation":{"date":"2026-05-12","status":"예약","item":"눈","items":["눈"]},"procedures":[{"kind":"surgery","date":"2026-05-13","status":"완료","items":["눈"]}],"issues":[]}]');
 second_id := consult.stage_import('synthetic.xlsx',repeat('a',64),'sheet','v1','[{"key":"3","externalId":"123","name":"synthetic","consultation":{"date":"2026-05-12","status":"예약","item":"눈","items":["눈"]},"procedures":[{"kind":"surgery","date":"2026-05-13","status":"완료","items":["눈"]}],"issues":[]}]');
 if first_id <> second_id then raise exception 'retry was not idempotent';end if;
 if (select count(*) from consult.imports) <> 1 then raise exception 'unexpected count';end if;
 perform consult.apply_import(first_id);
 perform consult.apply_import(first_id);
 if (select count(*) from consult.patients) <> 1 then raise exception 'patient upsert failed';end if;
 if (select count(*) from consult.consultations) <> 1 then raise exception 'consultation upsert failed';end if;
 if (select count(*) from consult.procedures) <> 1 then raise exception 'procedure upsert failed';end if;
 begin
   perform consult.stage_import('synthetic.xlsx',repeat('a',64),'sheet','v1','[{"key":"4"}]');
   raise exception 'test expected conflict';
 exception when raise_exception then
   if sqlerrm='test expected conflict' then raise;end if;
 end;
 begin
   insert into consult.patients(external_id,name) values('123','synthetic');
   raise exception 'clinical table allowed direct writes';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('test.uid','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if (select count(*) from consult.imports) <> 0 then raise exception 'cross-owner read';end if;
 perform consult.stage_import('synthetic.xlsx',repeat('a',64),'sheet','v1','[{"key":"3"}]');
 if (select count(*) from consult.imports) <> 1 then raise exception 'owner staging failed';end if;
end $$;
select set_config('test.jwt','{"app_metadata":{},"user_metadata":{"z_consult":true}}',false);
do $$ begin
 if (select count(*) from consult.imports) <> 0 then raise exception 'unprivileged read';end if;
 begin
   perform consult.stage_import('synthetic.xlsx',repeat('b',64),'sheet','v1','[{"key":"3"}]');
   raise exception 'test expected access denial';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'SQL isolation and staging tests passed' as result;
