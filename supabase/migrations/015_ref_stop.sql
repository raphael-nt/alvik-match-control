-- 015 Referee taps the clock to stop it (the page asks to confirm first).
--   Setup running : pause Setup (time left is kept). Tap again on the referee page to skip to Ready (uses setup_skip).
--   Game running  : stop the game clock now. The game goes to review and is decided by rules 6.2 to 6.4.
-- Once a game is stopped (by this or by Mission complete) the stop cannot be undone; scores can still be edited.
-- Run the whole file in the Supabase SQL Editor.

create or replace function public.a2_ref_stop(p_pin text, p_device text, p_session uuid) returns void
language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; ev a2_event; t int; actor text;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  actor := 'ref:'||left(p_device,6);
  perform a2_sync();
  select * into f from a2_field where no=1 for update;
  select * into ev from a2_event where id=1;
  select * into g from a2_game where match_code=f.match_code and status in ('ready','live','review') order by idx desc limit 1;
  if g.id is null then raise exception 'locked: ไม่มีเกมที่พร้อม'; end if;
  if f.phase='setup' and f.running then
    update a2_field set running=false, left_ms=greatest(0,(extract(epoch from (f.ends_at-now()))*1000)::int), ends_at=null, updated_at=now() where no=1;
    perform a2_audit(actor,'flow.setup_pause',f.match_code||'/g'||g.idx,null,null);
  elsif f.phase='game' and g.status='live' then
    t := least(ev.game_ms, greatest(0, (extract(epoch from (now()-f.go_at))*1000)::int));
    update a2_field set phase='stopped', running=false, ends_at=null, left_ms=ev.game_ms-t, stop_ms=t, updated_at=now() where no=1;
    update a2_game set status='review', version=version+1, updated_at=now() where id=g.id;
    perform a2_sum(g.id);
    perform a2_audit(actor,'flow.stop',f.match_code||'/g'||g.idx,null,jsonb_build_object('t_ms',t));
  else
    raise exception 'locked: หยุดเวลาตอนนี้ไม่ได้';
  end if;
end $$;
revoke all on function public.a2_ref_stop(text,text,uuid) from public;
grant execute on function public.a2_ref_stop(text,text,uuid) to anon, authenticated;

-- a2_ref_undo (from 008) except that a Mission complete mark can no longer be undone once the clock has stopped
create or replace function public.a2_ref_undo(p_pin text, p_device text, p_session uuid, p_id uuid) returns a2_game language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; mk a2_mark;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  select * into mk from a2_mark where id=p_id;
  if mk.id is null then raise exception 'locked: ไม่พบรายการ'; end if;
  select * into g from a2_game where id=mk.game_id for update;
  if g.match_code is distinct from f.match_code or g.status not in ('live','review') then raise exception 'locked: ย้อนไม่ได้แล้ว'; end if;
  if mk.voided or mk.kind='false_start' then return g; end if;
  if mk.kind='complete' then raise exception 'locked: เวลาหยุดแล้ว ย้อนไม่ได้ แก้คะแนนได้อย่างเดียว'; end if;
  update a2_mark set voided=true where id=p_id;
  perform a2_sum(g.id);
  perform a2_audit('ref:'||left(p_device,6),'mark.undo',g.match_code||'/g'||g.idx,to_jsonb(mk),null);
  select * into g from a2_game where id=g.id;
  return g;
end $$;
