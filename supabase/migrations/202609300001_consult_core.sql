-- Apply only to the intended Supabase project after review. Never resets existing schemas.
begin;
create schema if not exists consult;
revoke all on schema consult from public, anon;
grant usage on schema consult to authenticated;

create function consult.can_access() returns boolean
language sql stable security invoker set search_path = ''
as $$ select auth.uid() is not null and coalesce(auth.jwt()->'app_metadata'->>'z_consult', 'false') = 'true' $$;
revoke all on function consult.can_access() from public, anon;
grant execute on function consult.can_access() to authenticated;

create table consult.imports (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid(),
 file_name text not null check(length(file_name) between 1 and 255),
 file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 parser_version text not null check(length(parser_version) between 1 and 64),
 sheet_name text not null,
 extracted_at timestamptz,
 range_start date,
 range_end date,
 source_filters jsonb not null default '{}' check(jsonb_typeof(source_filters)='object'),
 status text not null default 'staged' check(status in ('staged','review','applied','reverted')),
 staged_records jsonb not null default '[]' check(jsonb_typeof(staged_records)='array'),
 result jsonb not null default '{}' check(jsonb_typeof(result)='object'),
 changes jsonb not null default '[]' check(jsonb_typeof(changes)='array'),
 created_at timestamptz not null default now(),
 unique(owner_id,file_sha256,sheet_name,parser_version), unique(id,owner_id),
 check(range_start is null or range_end is null or range_start<=range_end)
);
create table consult.patients (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid(),
 source_system text not null default 'consult-excel',
 external_id text not null check(length(trim(external_id))>0),
 name text not null check(length(trim(name))>0),
 source_fields jsonb not null default '{}' check(jsonb_typeof(source_fields)='object'),
 manual_notes text not null default '',
 last_import_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_id,source_system,external_id), unique(id,owner_id),
 foreign key(last_import_id,owner_id) references consult.imports(id,owner_id)
);
create table consult.consultations (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid(),
 patient_id uuid not null,
 source_visit_id text check(source_visit_id is null or length(trim(source_visit_id))>0),
 consultation_date date,
 items text[] not null default '{}',
 counselor text, doctor text, status text,
 source_snapshot jsonb not null default '{}' check(jsonb_typeof(source_snapshot)='object'),
 source_updated_at timestamptz,
 manual_notes text not null default '',
 no_booking_reasons text[] not null default '{}',
 reason_basis text check(reason_basis in ('patient_reported','staff_inference','unknown')),
 followup_at timestamptz, followup_status text, followup_notes text not null default '',
 last_import_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,patient_id,owner_id), unique(patient_id,source_visit_id),
 foreign key(patient_id,owner_id) references consult.patients(id,owner_id),
 foreign key(last_import_id,owner_id) references consult.imports(id,owner_id)
);
create table consult.procedures (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid(),
 patient_id uuid not null, consultation_id uuid,
 source_procedure_id text check(source_procedure_id is null or length(trim(source_procedure_id))>0),
 kind text not null check(kind in ('surgery','treatment')),
 items text[] not null default '{}', scheduled_date date, performed_date date, status text,
 source_snapshot jsonb not null default '{}' check(jsonb_typeof(source_snapshot)='object'),
 manual_notes text not null default '', last_import_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,patient_id,owner_id), unique(patient_id,source_procedure_id),
 foreign key(patient_id,owner_id) references consult.patients(id,owner_id),
 foreign key(consultation_id,patient_id,owner_id) references consult.consultations(id,patient_id,owner_id),
 foreign key(last_import_id,owner_id) references consult.imports(id,owner_id)
);
create table consult.photos (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid(), patient_id uuid not null, procedure_id uuid,
 bucket text not null default 'consult-photos' check(bucket='consult-photos'),
 object_path text not null check(length(trim(object_path))>0),
 captured_at timestamptz,
 phase text not null default 'unknown' check(phase in ('before','after','followup','unknown')),
 angle text, notes text not null default '',
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 byte_size bigint not null check(byte_size>0),
 created_at timestamptz not null default now(),
 unique(bucket,object_path),
 foreign key(patient_id,owner_id) references consult.patients(id,owner_id),
 foreign key(procedure_id,patient_id,owner_id) references consult.procedures(id,patient_id,owner_id)
);
create index consultations_patient on consult.consultations(owner_id,patient_id,consultation_date);
create index procedures_patient on consult.procedures(owner_id,patient_id);
create index photos_patient on consult.photos(owner_id,patient_id);

-- Owner isolation + a server-managed app claim. Ordinary face_app accounts cannot access data.
do $$ declare t text; begin
 foreach t in array array['imports','patients','consultations','procedures','photos'] loop
   execute format('alter table consult.%I enable row level security',t);
   execute format('create policy owner_access on consult.%I for all to authenticated using (consult.can_access() and owner_id = (select auth.uid())) with check (consult.can_access() and owner_id = (select auth.uid()))',t);
   execute format('revoke all on consult.%I from public, anon, authenticated',t);
   execute format('grant select on consult.%I to authenticated',t);
 end loop;
end $$;
-- This migration enables staging only. Clinical tables are read-only from the client.
grant insert(file_name,file_sha256,parser_version,sheet_name,extracted_at,range_start,range_end,source_filters,staged_records) on consult.imports to authenticated;

create function consult.stage_import(
 p_file_name text, p_file_sha256 text, p_sheet_name text, p_parser_version text,
 p_records jsonb, p_extracted_at timestamptz default null,
 p_range_start date default null, p_range_end date default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare batch_id uuid; existing_records jsonb;
begin
 if not consult.can_access() then raise exception 'consult access denied' using errcode='42501'; end if;
 if p_records is null or jsonb_typeof(p_records)<>'array' then raise exception 'records must be an array'; end if;
 if jsonb_array_length(p_records) not between 1 and 2000 or octet_length(p_records::text)>5242880 then
   raise exception 'staging limit: 1..2000 records, 5 MiB';
 end if;
 if exists(select 1 from jsonb_array_elements(p_records) r where jsonb_typeof(r)<>'object' or coalesce(r->>'key','')='') then
   raise exception 'each record needs a source key';
 end if;
 insert into consult.imports(file_name,file_sha256,sheet_name,parser_version,staged_records,extracted_at,range_start,range_end)
 values(p_file_name,p_file_sha256,p_sheet_name,p_parser_version,p_records,p_extracted_at,p_range_start,p_range_end)
 on conflict(owner_id,file_sha256,sheet_name,parser_version) do nothing returning id into batch_id;
 if batch_id is null then
   select id,staged_records into batch_id,existing_records from consult.imports
   where owner_id=auth.uid() and file_sha256=p_file_sha256 and sheet_name=p_sheet_name and parser_version=p_parser_version;
   if existing_records is distinct from p_records then raise exception 'same file/version has different parsed content'; end if;
 end if;
 return batch_id;
end $$;
revoke all on function consult.stage_import(text,text,text,text,jsonb,timestamptz,date,date) from public,anon;
grant execute on function consult.stage_import(text,text,text,text,jsonb,timestamptz,date,date) to authenticated;
commit;
