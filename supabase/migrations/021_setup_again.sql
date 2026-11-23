-- 021 Setup again : the referee can restart the Setup clock from the full setup time while the field is in
-- Setup or Ready (also right after a False start). The Pre-start checklist is cleared, so robots and stands
-- must be checked again before Start. a2_flow is the 008 version with one new action, setup_again.
create or replace function public.a2_flow(p_action text, p_actor text, p_force boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare f a2_field; ev a2_event; g a2_game; goat timestamptz; ok boolean;
begin
  perform a2_sync();
  select * into ev from a2_event;
  select * into f from a2_field where no=1 for update;
  if f.match_code is null then raise exception 'locked: ยังไม่มีคู่บนสนาม'; end if;
  select * into g from a2_game where match_code=f.match_code and status in ('ready','live','review') order by idx desc limit 1;
  if g.id is null then raise exception 'locked: ไม่มีเกมที่พร้อม'; end if;
  if p_action='setup_start' then
    if f.phase<>'idle' or g.status<>'ready' then raise exception 'locked: เริ่ม Setup ไม่ได้'; end if;
    if g.pattern is null then raise exception 'pattern: เลือกแบบสนามก่อน'; end if;
    update a2_field set phase='setup', running=true, ends_at=now()+make_interval(secs=>ev.setup_ms/1000.0), left_ms=null, go_at=null, stop_ms=null, updated_at=now() where no=1;
  elsif p_action='setup_again' then
    if f.phase not in ('setup','ready') or g.status<>'ready' then raise exception 'locked: เริ่ม Setup ใหม่ไม่ได้'; end if;
    if g.pattern is null then raise exception 'pattern: เลือกแบบสนามก่อน'; end if;
    update a2_field set phase='setup', running=true, ends_at=now()+make_interval(secs=>ev.setup_ms/1000.0), left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=1;
  elsif p_action='setup_skip' then
    if f.phase not in ('idle','setup') or g.status<>'ready' then raise exception 'locked: ข้าม Setup ไม่ได้'; end if;
    if g.pattern is null then raise exception 'pattern: เลือกแบบสนามก่อน'; end if;
    update a2_field set phase='ready', running=false, ends_at=null, left_ms=null, updated_at=now() where no=1;
  elsif p_action='go' then
    if f.phase<>'ready' or g.status<>'ready' then raise exception 'locked: เริ่มเกมไม่ได้'; end if;
    ok := coalesce((f.checks->>'red_in')::boolean,false) and coalesce((f.checks->>'blue_in')::boolean,false) and coalesce((f.checks->>'stands')::boolean,false);
    if not ok and not p_force then raise exception 'checklist: ตรวจรายการก่อนเริ่มให้ครบ'; end if;
    goat := now()+make_interval(secs=>ev.countdown_ms/1000.0);
    update a2_field set phase='countdown', running=true, go_at=goat, ends_at=goat+make_interval(secs=>ev.game_ms/1000.0), left_ms=null, stop_ms=null, updated_at=now() where no=1;
  elsif p_action='false_start' then
    if f.phase not in ('countdown','game') then raise exception 'locked: ใช้ False start ไม่ได้'; end if;
    update a2_mark set voided=true where game_id=g.id and not voided;
    insert into a2_mark(game_id,kind,t_ms,source,device) values (g.id,'false_start',a2_elapsed(f),'live',p_actor);
    update a2_game set status='ready' where id=g.id;
    perform a2_sum(g.id);
    update a2_field set phase='ready', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, updated_at=now() where no=1;
    perform a2_recompute();
  elsif p_action='reset' then
    update a2_mark set voided=true where game_id=g.id and not voided;
    update a2_game set status='ready' where id=g.id;
    perform a2_sum(g.id);
    update a2_field set phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=1;
    perform a2_recompute();
  else raise exception 'bad action'; end if;
  perform a2_audit(p_actor,'flow.'||p_action,f.match_code||'/g'||g.idx,null,null);
end $$;

create or replace function public.a2_ref_setup(p_pin text, p_device text, p_session uuid, p_action text) returns void
language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  if p_action not in ('start','skip','again') then raise exception 'bad action'; end if;
  perform a2_flow('setup_'||p_action,'ref:'||left(p_device,6),false);
end $$;
