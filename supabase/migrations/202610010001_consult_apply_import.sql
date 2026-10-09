-- Adds the reviewed import application step. Apply after 202609300001_consult_core.sql.
begin;

create or replace function consult.jsonb_text_array(p_value jsonb)
returns text[] language sql immutable set search_path = ''
as $$
 select coalesce(array_agg(trim(value)) filter (where trim(value) <> ''), '{}'::text[])
 from jsonb_array_elements_text(case when jsonb_typeof(p_value) = 'array' then p_value else '[]'::jsonb end)
$$;

create or replace function consult.apply_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_owner uuid := auth.uid();
 v_import consult.imports%rowtype;
 v_record jsonb;
 v_patient_id uuid;
 v_consultation_id uuid;
 v_external_id text;
 v_name text;
 v_visit_id text;
 v_consult jsonb;
 v_proc jsonb;
 v_proc_id text;
 v_proc_kind text;
 v_source_updated_text text;
 v_changes jsonb := '[]'::jsonb;
 v_result jsonb;
 v_upserted_patients integer := 0;
 v_upserted_consultations integer := 0;
 v_upserted_procedures integer := 0;
 v_skipped integer := 0;
 v_proc_index integer;
 v_row_count integer;
begin
 if not consult.can_access() then
   raise exception 'consult access denied' using errcode = '42501';
 end if;

 select * into v_import
 from consult.imports
 where id = p_import_id and owner_id = v_owner
 for update;

 if not found then
   raise exception 'import not found' using errcode = '42501';
 end if;

 if v_import.status not in ('staged','review','applied') then
   raise exception 'import status % cannot be applied', v_import.status;
 end if;

 for v_record in select value from jsonb_array_elements(v_import.staged_records)
 loop
   v_external_id := nullif(trim(coalesce(
     v_record->>'externalId',
     v_record->'fields'->>'No.',
     v_record->'fields'->>'NO',
     v_record->'fields'->>'no',
     v_record->'fields'->>'번호',
     v_record->'fields'->>'고객번호',
     v_record->'fields'->>'고객ID',
     v_record->'fields'->>'external_id',
     ''
   )), '');
   v_external_id := regexp_replace(v_external_id, '\.0+$', '');
   v_name := nullif(trim(coalesce(
     v_record->>'name',
     v_record->'fields'->>'이름',
     v_record->'fields'->>'고객명',
     v_record->'fields'->>'성명',
     v_record->'fields'->>'name',
     ''
   )), '');
   v_consult := coalesce(v_record->'consultation', '{}'::jsonb);
   v_source_updated_text := nullif(trim(coalesce(v_record->>'sourceUpdatedAt','')), '');

   if v_external_id is null or v_name is null then
     v_skipped := v_skipped + 1;
     v_changes := v_changes || jsonb_build_array(jsonb_build_object(
       'action','skipped',
       'key',v_record->>'key',
       'externalId',v_external_id,
       'reason','missing identity'
     ));
     continue;
   end if;

   insert into consult.patients(owner_id, source_system, external_id, name, source_fields, last_import_id, updated_at)
   values (v_owner, 'consult-excel', v_external_id, v_name, coalesce(v_record->'fields','{}'::jsonb), v_import.id, now())
   on conflict(owner_id, source_system, external_id) do update
   set name = excluded.name,
       source_fields = consult.patients.source_fields || excluded.source_fields,
       last_import_id = excluded.last_import_id,
       updated_at = now()
   returning id into v_patient_id;

   get diagnostics v_row_count = row_count;
   v_upserted_patients := v_upserted_patients + v_row_count;

   v_visit_id := nullif(trim(coalesce(v_record->>'sourceVisitId','')), '');
   if v_visit_id is null then
     v_visit_id := 'auto:' || md5(concat_ws('|',
       v_external_id,
       coalesce(v_consult->>'date', v_consult->>'date1', ''),
       coalesce(v_consult->>'item', '')
     ));
   end if;

   insert into consult.consultations(
     owner_id, patient_id, source_visit_id, consultation_date, items, counselor, doctor, status,
     source_snapshot, source_updated_at, last_import_id, updated_at
   )
   values (
     v_owner,
     v_patient_id,
     v_visit_id,
     nullif(coalesce(v_consult->>'date', v_consult->>'date1', ''), '')::date,
     consult.jsonb_text_array(v_consult->'items'),
     nullif(trim(coalesce(v_consult->>'counselor','')), ''),
     nullif(trim(coalesce(v_consult->>'doctor','')), ''),
     nullif(trim(coalesce(v_consult->>'status', v_consult->>'status1', '')), ''),
     v_record,
     case when v_source_updated_text ~ '^\d{4}-\d{2}-\d{2}' then v_source_updated_text::timestamptz else null end,
     v_import.id,
     now()
   )
   on conflict(patient_id, source_visit_id) do update
   set consultation_date = excluded.consultation_date,
       items = excluded.items,
       counselor = excluded.counselor,
       doctor = excluded.doctor,
       status = excluded.status,
       source_snapshot = excluded.source_snapshot,
       source_updated_at = excluded.source_updated_at,
       last_import_id = excluded.last_import_id,
       updated_at = now()
   returning id into v_consultation_id;

   v_upserted_consultations := v_upserted_consultations + 1;

   v_proc_index := 0;
   for v_proc in select value from jsonb_array_elements(coalesce(v_record->'procedures','[]'::jsonb))
   loop
     v_proc_index := v_proc_index + 1;
     v_proc_kind := coalesce(nullif(v_proc->>'kind',''), 'surgery');
     if v_proc_kind not in ('surgery','treatment') then
       v_proc_kind := 'surgery';
     end if;
     v_proc_id := coalesce(nullif(v_proc->>'sourceProcedureId',''), v_visit_id || ':' || v_proc_kind || ':' || v_proc_index::text);

     insert into consult.procedures(
       owner_id, patient_id, consultation_id, source_procedure_id, kind, items,
       scheduled_date, performed_date, status, source_snapshot, last_import_id, updated_at
     )
     values (
       v_owner,
       v_patient_id,
       v_consultation_id,
       v_proc_id,
       v_proc_kind,
       consult.jsonb_text_array(v_proc->'items'),
       nullif(coalesce(v_proc->>'date', v_proc->>'date1', ''), '')::date,
       nullif(coalesce(v_proc->>'date', v_proc->>'date1', ''), '')::date,
       nullif(trim(coalesce(v_proc->>'status', v_proc->>'status1', '')), ''),
       v_proc,
       v_import.id,
       now()
     )
     on conflict(patient_id, source_procedure_id) do update
     set consultation_id = excluded.consultation_id,
         kind = excluded.kind,
         items = excluded.items,
         scheduled_date = excluded.scheduled_date,
         performed_date = excluded.performed_date,
         status = excluded.status,
         source_snapshot = excluded.source_snapshot,
         last_import_id = excluded.last_import_id,
         updated_at = now();

     v_upserted_procedures := v_upserted_procedures + 1;
   end loop;

   v_changes := v_changes || jsonb_build_array(jsonb_build_object(
     'action','upserted',
     'key',v_record->>'key',
     'externalId',v_external_id,
     'patientId',v_patient_id,
     'consultationId',v_consultation_id,
     'sourceVisitId',v_visit_id
   ));
 end loop;

 v_result := jsonb_build_object(
   'applied_at', now(),
   'patients_upserted', v_upserted_patients,
   'consultations_upserted', v_upserted_consultations,
   'procedures_upserted', v_upserted_procedures,
   'records_skipped', v_skipped
 );

 update consult.imports
 set status = 'applied',
     result = v_result,
     changes = v_changes
 where id = v_import.id and owner_id = v_owner;

 return v_result;
end $$;

revoke all on function consult.jsonb_text_array(jsonb) from public, anon;
grant execute on function consult.jsonb_text_array(jsonb) to authenticated;
revoke all on function consult.apply_import(uuid) from public, anon;
grant execute on function consult.apply_import(uuid) to authenticated;

create or replace function consult.list_consultation_rows()
returns table(
 consultation_id uuid,
 patient_id uuid,
 external_id text,
 patient_name text,
 consultation_date date,
 consultation_items text[],
 consultation_item text,
 consultation_status text,
 counselor text,
 doctor text,
 procedure_date date,
 procedure_items text[],
 procedure_item text,
 procedure_status text,
 has_issues boolean,
 issues jsonb,
 patient_notes text,
 consultation_notes text,
 source_snapshot jsonb,
 updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
 select
   c.id as consultation_id,
   p.id as patient_id,
   p.external_id,
   p.name as patient_name,
   c.consultation_date,
   c.items as consultation_items,
   array_to_string(c.items, ', ') as consultation_item,
   c.status as consultation_status,
   c.counselor,
   c.doctor,
   pr.performed_date as procedure_date,
   pr.items as procedure_items,
   array_to_string(pr.items, E'\n') as procedure_item,
   pr.status as procedure_status,
   jsonb_array_length(coalesce(c.source_snapshot->'issues','[]'::jsonb)) > 0 as has_issues,
   coalesce(c.source_snapshot->'issues','[]'::jsonb) as issues,
   p.manual_notes as patient_notes,
   c.manual_notes as consultation_notes,
   c.source_snapshot,
   c.updated_at
 from consult.consultations c
 join consult.patients p on p.id = c.patient_id and p.owner_id = c.owner_id
 left join lateral (
   select performed_date, items, status
   from consult.procedures pr
   where pr.consultation_id = c.id and pr.owner_id = c.owner_id
   order by pr.performed_date nulls last, pr.created_at
   limit 1
 ) pr on true
 where c.owner_id = auth.uid()
 order by c.consultation_date desc nulls last, p.external_id, c.created_at desc
$$;

revoke all on function consult.list_consultation_rows() from public, anon;
grant execute on function consult.list_consultation_rows() to authenticated;

commit;
