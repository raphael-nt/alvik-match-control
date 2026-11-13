-- 016 Referee clock control from the tap-on-clock popup.
--   pause  : Setup or game clock stops, time left is kept. Marks can still be recorded while paused.
--   resume : clock continues from the time left. For the game, go_at moves forward so elapsed time stays correct.
--   end    : game ends now (running or paused). The game goes to review and cannot be undone.
-- a2_ref_stop from 015 stays for older pages. Run the whole file in the Supabase SQL Editor.

create or replace function public.a2_ref_clock(p_pin text, p_device text, p_session uuid, p_action text) returns void
language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; ev a2_event; rem int; t int; actor text; ends timestamptz;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  actor := 'ref:'||left(p_device,6);
  if p_action not in ('pause','resume','end') then raise exception 'bad action'; end if;
  perform a2_sync();
  select * into f from a2_field where no=1 for update;
  select * into ev from a2_event where id=1;
  select * into g from a2_game where match_code=f.match_code and status in ('ready','live','review') order by idx desc limit 1;
  if g.id is null then raise exception 'locked: ไม่มีเกมที่พร้อม'; end if;

  if p_action='pause' then
    if f.phase not in ('setup','game') or not f.running then raise exception 'locked: หยุดเวลาตอนนี้ไม่ได้'; end if;
    rem := greatest(0,(extract(epoch from (f.ends_at-now()))*1000)::int);
    update a2_field set running=false, left_ms=rem, ends_at=null, updated_at=now() where no=1;

  elsif p_action='resume' then
    if f.phase not in ('setup','game') or f.running then raise exception 'locked: เวลาไม่ได้หยุดอยู่'; end if;
    ends := now()+make_interval(secs=>coalesce(f.left_ms,0)/1000.0);
    if f.phase='setup' then
      update a2_field set running=true, ends_at=ends, left_ms=null, updated_at=now() where no=1;
    else
      update a2_field set running=true, ends_at=ends, go_at=ends-make_interval(secs=>ev.game_ms/1000.0), left_ms=null, updated_at=now() where no=1;
    end if;

  else -- end
    if f.phase<>'game' or g.status<>'live' then raise exception 'locked: จบเกมตอนนี้ไม่ได้'; end if;
    rem := case when f.running then greatest(0,(extract(epoch from (f.ends_at-now()))*1000)::int) else coalesce(f.left_ms,0) end;
    t := least(ev.game_ms, greatest(0, ev.game_ms-rem));
    update a2_field set phase='stopped', running=false, ends_at=null, left_ms=ev.game_ms-t, stop_ms=t, updated_at=now() where no=1;
    update a2_game set status='review', version=version+1, updated_at=now() where id=g.id;
    perform a2_sum(g.id);
  end if;
  perform a2_audit(actor,'flow.clock_'||p_action,f.match_code||'/g'||g.idx,null,null);
end $$;
revoke all on function public.a2_ref_clock(text,text,uuid,text) from public;
grant execute on function public.a2_ref_clock(text,text,uuid,text) to anon, authenticated;
