-- 023 Undo Knockout : a Mission complete pressed by mistake can be taken back while the game is still in review.
-- The Knockout mark is voided and the clock runs on from where it stopped (the time left is game_ms - stop_ms).
-- Allowed only before the result is confirmed. The referee phone and Admin (a2_adm_ref 'ko_undo') use it.

create or replace function public.a2_ref_ko_undo(p_pin text, p_device text, p_session uuid, p_game bigint) returns a2_game
language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; mk a2_mark; ev a2_event; rem int; ends timestamptz; actor text;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  actor := 'ref:'||left(p_device,6);
  select * into ev from a2_event where id=1;
  select * into g from a2_game where id=p_game for update;
  if g.id is null or g.match_code is distinct from f.match_code then raise exception 'forbidden: game'; end if;
  if g.status<>'review' or f.phase<>'stopped' then raise exception 'locked: ย้อน Knockout ได้เฉพาะก่อนรับรองผล'; end if;
  select * into mk from a2_mark where game_id=g.id and kind='complete' and not voided order by created_at desc limit 1;
  if mk.id is null then raise exception 'locked: เกมนี้ไม่มี Knockout ให้ย้อน'; end if;
  update a2_mark set voided=true where id=mk.id;
  -- Run on from the moment the clock stopped
  rem := greatest(0, ev.game_ms - coalesce(f.stop_ms, mk.t_ms, 0));
  ends := now()+make_interval(secs=>rem/1000.0);
  update a2_field set phase='game', running=true, ends_at=ends, go_at=ends-make_interval(secs=>ev.game_ms/1000.0), left_ms=null, stop_ms=null, updated_at=now() where no=1;
  update a2_game set status='live' where id=g.id;
  perform a2_sum(g.id);
  perform a2_audit(actor,'mark.ko_undo',g.match_code||'/g'||g.idx,to_jsonb(mk),jsonb_build_object('left_ms',rem));
  select * into g from a2_game where id=g.id;
  return g;
end $$;
revoke all on function public.a2_ref_ko_undo(text,text,uuid,bigint) from public;
grant execute on function public.a2_ref_ko_undo(text,text,uuid,bigint) to anon, authenticated;

-- a2_adm_ref from 022 with one new action, ko_undo
create or replace function public.a2_adm_ref(p_pw text, p_fn text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb; d constant text := 'admin';
begin
  perform a2_need_admin(p_pw);
  perform set_config('a2.admin', '1', true);
  p := coalesce(p, '{}'::jsonb);
  case p_fn
    when 'pattern' then r := to_jsonb(a2_ref_pattern(null, d, null, (p->>'game')::bigint, (p->>'n')::int));
    when 'setup' then perform a2_ref_setup(null, d, null, p->>'action');
    when 'check' then r := a2_ref_check(null, d, null, p->>'item', (p->>'on')::boolean);
    when 'go' then perform a2_ref_go(null, d, null);
    when 'false_start' then perform a2_ref_false_start(null, d, null);
    when 'mark' then r := to_jsonb(a2_ref_mark(null, d, null, (p->>'game')::bigint, coalesce((p->>'id')::uuid, gen_random_uuid()), p->>'kind', p->>'side', (p->>'t_ms')::int));
    when 'undo' then r := to_jsonb(a2_ref_undo(null, d, null, (p->>'id')::uuid));
    when 'ko_undo' then r := to_jsonb(a2_ref_ko_undo(null, d, null, (p->>'game')::bigint));
    when 'clock' then perform a2_ref_clock(null, d, null, p->>'action');
    when 'confirm' then r := to_jsonb(a2_ref_confirm(null, d, null, (p->>'game')::bigint));
    when 'judge' then perform a2_ref_judge(null, d, null, (p->>'game')::bigint, p->>'side');
    else raise exception 'bad action';
  end case;
  perform set_config('a2.admin', '', true);
  return r;
end $$;
grant execute on function public.a2_adm_ref(text, text, jsonb) to anon, authenticated;
