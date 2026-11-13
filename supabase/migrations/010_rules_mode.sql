-- 010 rules mode switch.
-- rules_mode = true: Smart Logistics Challenge flow (setup, checklist, clock, criteria).
-- rules_mode = false: referee only picks the winner of each game.

alter table public.a2_event add column if not exists rules_mode boolean not null default true;

create or replace function public.a2_adm_event(p_pw text, p jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  update a2_event set
    name=coalesce(p->>'name',name), setup_ms=coalesce((p->>'setup_ms')::int,setup_ms), game_ms=coalesce((p->>'game_ms')::int,game_ms),
    countdown_ms=coalesce((p->>'countdown_ms')::int,countdown_ms), tv_mode=coalesce(p->>'tv_mode',tv_mode),
    rules_mode=coalesce((p->>'rules_mode')::boolean,rules_mode),
    tv_focus=case when p ? 'tv_focus' then nullif(p->>'tv_focus','')::int else tv_focus end,
    draw_state=case when p ? 'draw_state' then p->'draw_state' else draw_state end, updated_at=now();
  if p ? 'new_pw' then update a2_secret set admin_hash=a2_hash(p->>'new_pw'); end if;
  if p ? 'new_pin' then update a2_secret set ref_hash=a2_hash(p->>'new_pin'); end if;
  perform a2_audit('admin','event.update',null,null,p - 'new_pw' - 'new_pin');
end $$;

-- Simple mode: referee records the winner of the current game
create or replace function public.a2_ref_winner(p_pin text, p_device text, p_session uuid, p_game bigint, p_side text) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  if (select rules_mode from a2_event) then raise exception 'locked: โหมดกติกาเปิดอยู่ ใช้ Checklist แทน'; end if;
  if p_side not in ('red','blue') then raise exception 'bad side'; end if;
  select * into g from a2_game where id=p_game for update;
  if g.id is null or g.match_code is distinct from f.match_code or g.status not in ('ready','live','review') then raise exception 'locked: บันทึกผลเกมนี้ไม่ได้'; end if;
  update a2_game set status='done', winner=p_side, method='judge', decided_by='referee', need=null, version=version+1, updated_at=now() where id=p_game;
  perform a2_recompute();
  perform a2_ensure_game(g.match_code);
  update a2_field set phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=1;
  perform a2_audit('ref:'||left(p_device,6),'game.winner',g.match_code||'/g'||g.idx,null,jsonb_build_object('side',p_side));
end $$;

revoke all on function public.a2_ref_winner(text,text,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.a2_ref_winner(text,text,uuid,bigint,text) to anon, authenticated;
revoke all on function public.a2_adm_event(text,jsonb) from public, anon, authenticated;
grant execute on function public.a2_adm_event(text,jsonb) to anon, authenticated;
