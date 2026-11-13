-- 011 Dashboard layout set from Admin > Dashboard (panel position and size per screen)
alter table public.a2_event add column if not exists dash_layout jsonb;

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
    draw_state=case when p ? 'draw_state' then p->'draw_state' else draw_state end, updated_at=now();
  if p ? 'new_pw' then update a2_secret set admin_hash=a2_hash(p->>'new_pw'); end if;
  if p ? 'new_pin' then update a2_secret set ref_hash=a2_hash(p->>'new_pin'); end if;
  perform a2_audit('admin','event.update',null,null,p - 'new_pw' - 'new_pin');
end $$;
revoke all on function public.a2_adm_event(text,jsonb) from public, anon, authenticated;
grant execute on function public.a2_adm_event(text,jsonb) to anon, authenticated;
