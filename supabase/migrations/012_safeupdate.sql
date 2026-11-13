-- 012 Supabase loads pg-safeupdate for API sessions, which rejects any UPDATE or DELETE without a WHERE clause.
-- Several a2_ functions update single-row or whole tables on purpose, so calls from the web failed with
-- "UPDATE requires a WHERE clause". Run this whole file in the Supabase SQL Editor.

-- 1. a2_adm_event (Dashboard mode, name, timing, layout, password and PIN): explicit WHERE clauses
create or replace function public.a2_adm_event(p_pw text, p jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  if p ? 'dash_layout' and pg_column_size(p->'dash_layout') > 8000 then raise exception 'bad layout'; end if;
  update a2_event set
    name=coalesce(p->>'name',name), setup_ms=coalesce((p->>'setup_ms')::int,setup_ms), game_ms=coalesce((p->>'game_ms')::int,game_ms),
    countdown_ms=coalesce((p->>'countdown_ms')::int,countdown_ms), tv_mode=coalesce(p->>'tv_mode',tv_mode),
    rules_mode=coalesce((p->>'rules_mode')::boolean,rules_mode),
    dash_layout=case when p ? 'dash_layout' then nullif(p->'dash_layout','null'::jsonb) else dash_layout end,
    tv_focus=case when p ? 'tv_focus' then nullif(p->>'tv_focus','')::int else tv_focus end,
    draw_state=case when p ? 'draw_state' then p->'draw_state' else draw_state end, updated_at=now()
  where id=1;
  if p ? 'new_pw' then update a2_secret set admin_hash=a2_hash(p->>'new_pw') where true; end if;
  if p ? 'new_pin' then update a2_secret set ref_hash=a2_hash(p->>'new_pin') where true; end if;
  perform a2_audit('admin','event.update',null,null,p - 'new_pw' - 'new_pin');
end $$;
revoke all on function public.a2_adm_event(text,jsonb) from public, anon, authenticated;
grant execute on function public.a2_adm_event(text,jsonb) to anon, authenticated;

-- 2. Every other a2_ function: turn safeupdate off while the function runs (covers reset, format, recompute and the rest).
-- Each ALTER is wrapped so one failure cannot stop the migration; the notices list anything that was skipped.
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname like 'a2\_%' and p.prokind='f' loop
    begin
      execute format('alter function %s set safeupdate.enabled = 0', r.fn);
    exception when others then
      raise notice 'skip %: %', r.fn, sqlerrm;
    end;
  end loop;
end $$;

-- Check : should list the a2_ functions with safeupdate.enabled=0 in proconfig
select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'a2\_%' order by 1;
