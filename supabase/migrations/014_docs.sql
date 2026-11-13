-- 014 Documents (rules, FAQ and any file the admin adds) stored in the database.
-- Admin uploads, deletes and opens them in Settings. Referees can open them only when a2_event.docs_ref is on.
-- Files are kept as base64 text, at most 10 MB each. Run the whole file in the Supabase SQL Editor.

alter table public.a2_event add column if not exists docs_ref boolean not null default true;

create table if not exists public.a2_doc(
  id bigint generated always as identity primary key,
  title text not null,
  file_name text not null,
  mime text not null default 'application/pdf',
  size int not null,
  data text not null,
  order_no int not null default 0,
  created_at timestamptz not null default now());
-- No direct table access: everything goes through the functions below
alter table public.a2_doc enable row level security;
revoke all on table public.a2_doc from anon, authenticated;

-- Caller may read documents: admin password, or referee PIN while docs_ref is on
create or replace function public.a2_doc_can_read(p_pw text, p_pin text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from a2_secret where p_pw is not null and admin_hash=a2_hash(p_pw))
      or ((select docs_ref from a2_event where id=1) and exists(select 1 from a2_secret where p_pin is not null and ref_hash=a2_hash(p_pin)))
$$;

-- List without file data
create or replace function public.a2_doc_list(p_pw text default null, p_pin text default null)
returns table(id bigint, title text, file_name text, mime text, size int, created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
  if not a2_doc_can_read(p_pw, p_pin) then raise exception 'forbidden: documents'; end if;
  return query select d.id, d.title, d.file_name, d.mime, d.size, d.created_at from a2_doc d order by d.order_no, d.id;
end $$;

-- One file with its base64 data
create or replace function public.a2_doc_get(p_id bigint, p_pw text default null, p_pin text default null)
returns table(id bigint, title text, file_name text, mime text, data text)
language plpgsql stable security definer set search_path=public as $$
begin
  if not a2_doc_can_read(p_pw, p_pin) then raise exception 'forbidden: documents'; end if;
  return query select d.id, d.title, d.file_name, d.mime, d.data from a2_doc d where d.id=p_id;
end $$;

create or replace function public.a2_adm_doc_add(p_pw text, p_title text, p_file_name text, p_mime text, p_data text) returns bigint
language plpgsql security definer set search_path=public as $$
declare n int := (length(p_data) * 3) / 4; new_id bigint;
begin
  perform a2_need_admin(p_pw);
  if coalesce(trim(p_title),'')='' then raise exception 'ต้องใส่ชื่อเอกสาร'; end if;
  if n > 10 * 1024 * 1024 then raise exception 'ไฟล์ใหญ่เกิน 10 MB'; end if;
  insert into a2_doc(title, file_name, mime, size, data, order_no)
    values (trim(p_title), coalesce(nullif(p_file_name,''),'file'), coalesce(nullif(p_mime,''),'application/octet-stream'), n, p_data,
            coalesce((select max(order_no)+1 from a2_doc),0))
    returning a2_doc.id into new_id;
  perform a2_audit('admin','doc.add',new_id::text,null,jsonb_build_object('title',p_title,'size',n));
  return new_id;
end $$;

create or replace function public.a2_adm_doc_del(p_pw text, p_id bigint) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  delete from a2_doc where id=p_id;
  perform a2_audit('admin','doc.delete',p_id::text,null,null);
end $$;

-- a2_adm_event (latest from 012) plus docs_ref
create or replace function public.a2_adm_event(p_pw text, p jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  if p ? 'dash_layout' and pg_column_size(p->'dash_layout') > 8000 then raise exception 'bad layout'; end if;
  update a2_event set
    name=coalesce(p->>'name',name), setup_ms=coalesce((p->>'setup_ms')::int,setup_ms), game_ms=coalesce((p->>'game_ms')::int,game_ms),
    countdown_ms=coalesce((p->>'countdown_ms')::int,countdown_ms), tv_mode=coalesce(p->>'tv_mode',tv_mode),
    rules_mode=coalesce((p->>'rules_mode')::boolean,rules_mode),
    docs_ref=coalesce((p->>'docs_ref')::boolean,docs_ref),
    dash_layout=case when p ? 'dash_layout' then nullif(p->'dash_layout','null'::jsonb) else dash_layout end,
    tv_focus=case when p ? 'tv_focus' then nullif(p->>'tv_focus','')::int else tv_focus end,
    draw_state=case when p ? 'draw_state' then p->'draw_state' else draw_state end, updated_at=now()
  where id=1;
  if p ? 'new_pw' then update a2_secret set admin_hash=a2_hash(p->>'new_pw') where true; end if;
  if p ? 'new_pin' then update a2_secret set ref_hash=a2_hash(p->>'new_pin') where true; end if;
  perform a2_audit('admin','event.update',null,null,p - 'new_pw' - 'new_pin');
end $$;

revoke all on function public.a2_doc_can_read(text,text) from public, anon, authenticated;
revoke all on function public.a2_doc_list(text,text), public.a2_doc_get(bigint,text,text), public.a2_adm_doc_add(text,text,text,text,text), public.a2_adm_doc_del(text,bigint), public.a2_adm_event(text,jsonb) from public;
grant execute on function public.a2_doc_list(text,text), public.a2_doc_get(bigint,text,text), public.a2_adm_doc_add(text,text,text,text,text), public.a2_adm_doc_del(text,bigint), public.a2_adm_event(text,jsonb) to anon, authenticated;
