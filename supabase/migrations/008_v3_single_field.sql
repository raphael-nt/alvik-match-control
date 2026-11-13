-- 008 v3: single field, one central clock, event log (a2_mark)
-- See docs/DESIGN_v3.md section 7. Run order: 001 to 007, then 008
-- Warning: this breaks the v2 web pages (admin, ref, tv). Deploy the v3 pages together

-- ===== 1. Drop old functions whose signature changes =====
drop function if exists public.a2_adm_assign(text,text,int);
drop function if exists public.a2_adm_unassign(text,int);
drop function if exists public.a2_adm_timer(text,int,text);
drop function if exists public.a2_do_assign(text,int,text);
drop function if exists public.a2_timer_do(public.a2_field,text,text);
drop function if exists public.a2_ref_claim(text,text,int);
drop function if exists public.a2_ref_check(text,text,int,uuid);
drop function if exists public.a2_ref_heartbeat(text,text,int,uuid);
drop function if exists public.a2_ref_release(text,text,int);
drop function if exists public.a2_ref_timer(text,text,int,uuid,text);
drop function if exists public.a2_ref_op(text,text,int,uuid,bigint,text,text,int);
drop function if exists public.a2_ref_finish(text,text,int,uuid,bigint);
drop function if exists public.a2_ref_judge(text,text,int,uuid,bigint,text);

-- ===== 2. Tables and columns =====
-- Keep a single field row
update public.a2_match set field_no=null where field_no is not null and field_no<>1;
delete from public.a2_fdev where no<>1;
delete from public.a2_field where no<>1;
alter table public.a2_field add constraint a2_field_single check (no=1);
alter table public.a2_field
  add column if not exists go_at timestamptz,          -- server time at GO
  add column if not exists stop_ms int,                -- time the clock stopped (Mission complete or time up)
  add column if not exists checks jsonb not null default '{}'::jsonb;  -- Pre-start checklist: red_in, blue_in, stands
-- phase: idle setup ready countdown game stopped over

alter table public.a2_event drop column if exists field_count;
alter table public.a2_event add column if not exists countdown_ms int not null default 3000;
alter table public.a2_match drop column if exists sched_field;
alter table public.a2_match add column if not exists absent_req text check (absent_req in ('red','blue'));  -- referee absent request, waiting for admin

alter table public.a2_game
  add column if not exists exit_side text check (exit_side in ('red','blue','both')),
  add column if not exists exit_ms int,
  add column if not exists lift_side text check (lift_side in ('red','blue','both')),
  add column if not exists lift_ms int,
  add column if not exists complete_side text check (complete_side in ('red','blue','both')),
  add column if not exists complete_ms int,
  add column if not exists red_retries int not null default 0,
  add column if not exists blue_retries int not null default 0,
  drop column if exists red_full_ms, drop column if exists blue_full_ms,
  drop column if exists red_lift_ms, drop column if exists blue_lift_ms,
  drop column if exists red_exit_ms, drop column if exists blue_exit_ms;

create table public.a2_mark(
  id uuid primary key default gen_random_uuid(),
  game_id bigint not null references public.a2_game(id) on delete cascade,
  kind text not null check (kind in ('exit_first','lift_first','park','unpark','complete','retry','false_start')),
  side text check (side in ('red','blue','both')),
  t_ms int not null default 0 check (t_ms>=0),
  voided boolean not null default false,
  source text not null default 'live' check (source in ('live','review','admin')),
  device text,
  created_at timestamptz not null default now());
create index a2_mark_game on public.a2_mark(game_id, created_at);
create unique index a2_mark_once on public.a2_mark(game_id, kind) where not voided and kind in ('exit_first','lift_first','complete');
alter table public.a2_mark enable row level security;
create policy a2_mark_read on public.a2_mark for select to anon, authenticated using (true);
revoke insert,update,delete,truncate on public.a2_mark from anon, authenticated;
alter publication supabase_realtime add table public.a2_mark;

-- ===== 3. Decider v3 (design 7.4) =====
create or replace function public.a2_decide(g public.a2_game, out side text, out method text, out need text)
language plpgsql immutable set search_path=public as $$
begin
  if g.complete_side in ('red','blue') then side:=g.complete_side; method:='full'; return; end if;       -- 6.1
  if g.red_parked<>g.blue_parked then side:=case when g.red_parked>g.blue_parked then 'red' else 'blue' end; method:='count'; return; end if; -- 6.2
  if g.lift_side is not null then                                                                          -- 6.3
    if g.lift_side='both' then need:='replay'; return; end if;
    side:=g.lift_side; method:='lift'; return;
  end if;
  if g.exit_side is not null then                                                                          -- 6.4
    if g.exit_side='both' then need:='replay'; return; end if;
    side:=g.exit_side; method:='exit'; return;
  end if;
  need:='judge';                                                                                           -- FAQ 35
end $$;

-- ===== 4. Game summary columns, computed from non-voided events =====
create function public.a2_sum(p_game bigint) returns void language plpgsql security definer set search_path=public as $$
begin
  update a2_game g set
    exit_side=(select m.side from a2_mark m where m.game_id=g.id and m.kind='exit_first' and not m.voided),
    exit_ms=(select m.t_ms from a2_mark m where m.game_id=g.id and m.kind='exit_first' and not m.voided),
    lift_side=(select m.side from a2_mark m where m.game_id=g.id and m.kind='lift_first' and not m.voided),
    lift_ms=(select m.t_ms from a2_mark m where m.game_id=g.id and m.kind='lift_first' and not m.voided),
    complete_side=(select m.side from a2_mark m where m.game_id=g.id and m.kind='complete' and not m.voided),
    complete_ms=(select m.t_ms from a2_mark m where m.game_id=g.id and m.kind='complete' and not m.voided),
    red_retries=(select count(*) from a2_mark m where m.game_id=g.id and m.kind='retry' and m.side='red' and not m.voided),
    blue_retries=(select count(*) from a2_mark m where m.game_id=g.id and m.kind='retry' and m.side='blue' and not m.voided),
    red_parked=greatest(0,least(3,(select count(*) filter (where m.kind='park')-count(*) filter (where m.kind='unpark') from a2_mark m where m.game_id=g.id and m.side='red' and not m.voided))),
    blue_parked=greatest(0,least(3,(select count(*) filter (where m.kind='park')-count(*) filter (where m.kind='unpark') from a2_mark m where m.game_id=g.id and m.side='blue' and not m.voided))),
    version=g.version+1, updated_at=now()
  where g.id=p_game;
  update a2_game set red_parked=3 where id=p_game and complete_side in ('red','both');   -- Mission complete means 3 stands
  update a2_game set blue_parked=3 where id=p_game and complete_side in ('blue','both');
  update a2_match set updated_at=now() where code=(select match_code from a2_game where id=p_game);
end $$;

-- Time since GO (ms) by server clock
create or replace function public.a2_elapsed(f public.a2_field) returns int language plpgsql stable security definer set search_path=public as $$
declare ev a2_event;
begin
  select * into ev from a2_event;
  if f.phase='stopped' then return coalesce(f.stop_ms,0); end if;
  if f.phase='over' then return ev.game_ms; end if;
  if f.go_at is null or f.phase not in ('game','countdown') then return 0; end if;
  return least(ev.game_ms, greatest(0,(extract(epoch from (now()-f.go_at))*1000)::int));
end $$;

-- ===== 5. Advance state by time (setup end, GO, 1:30 up) =====
create function public.a2_sync() returns void language plpgsql security definer set search_path=public as $$
declare f a2_field; ev a2_event; gid bigint; ph text;
begin
  select * into ev from a2_event;
  select * into f from a2_field where no=1 for update;
  if f.match_code is null then return; end if;
  select id into gid from a2_game where match_code=f.match_code and status in ('ready','live','review') order by idx desc limit 1;
  ph := f.phase;
  if ph='setup' and f.running and f.ends_at<=now() then
    update a2_field set phase='ready', running=false, ends_at=null, left_ms=null, updated_at=now() where no=1;
  end if;
  if ph='countdown' and f.go_at<=now() then
    update a2_field set phase='game', updated_at=now() where no=1;
    update a2_game set status='live', version=version+1, updated_at=now() where id=gid and status='ready';
    update a2_match set status='live', updated_at=now() where code=f.match_code;
    ph := 'game';
  end if;
  if ph='game' and f.running and f.ends_at<=now() then
    update a2_field set phase='over', running=false, ends_at=null, left_ms=0, stop_ms=ev.game_ms, updated_at=now() where no=1;
    update a2_game set status='review', version=version+1, updated_at=now() where id=gid and status='live';
    update a2_match set updated_at=now() where code=f.match_code;
  end if;
end $$;

-- ===== 6. Close game (tie means replay with the same pattern) =====
create or replace function public.a2_close_game(p_game bigint, p_actor text) returns text language plpgsql security definer set search_path=public as $$
declare g a2_game; d record; f a2_field;
begin
  select * into g from a2_game where id=p_game for update;
  select * into d from a2_decide(g);
  select * into f from a2_field where match_code=g.match_code;
  if d.side is not null then
    update a2_game set status='done', winner=d.side, method=d.method, need=null, decided_by=case when p_actor like 'admin%' then 'admin' else 'auto' end, version=version+1, updated_at=now() where id=p_game;
  elsif d.need='replay' then
    update a2_game set status='replay', need=null, note=coalesce(note,'เสมอ แข่งใหม่'), version=version+1, updated_at=now() where id=p_game;
    insert into a2_game(match_code,idx,pattern) values (g.match_code,(select max(idx)+1 from a2_game where match_code=g.match_code),g.pattern);
  else
    update a2_game set status='review', need='judge', version=version+1, updated_at=now() where id=p_game;
    return 'judge';
  end if;
  perform a2_recompute();
  perform a2_ensure_game(g.match_code);
  if f.no is not null then
    update a2_field set phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=f.no;
  end if;
  return coalesce(d.side,'replay');
end $$;

-- ===== 7. Game flow (referee via a2_ref_*, admin via a2_adm_timer) =====
create function public.a2_flow(p_action text, p_actor text, p_force boolean default false) returns void language plpgsql security definer set search_path=public as $$
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

-- ===== 8. Referee =====
create function public.a2_ref_auth(p_pin text, p_device text, p_session uuid) returns a2_field language plpgsql security definer set search_path=public as $$
declare f a2_field; dv text;
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  perform a2_sync();
  select * into f from a2_field where no=1 for update;
  select device into dv from a2_fdev where no=1;
  if f.match_code is null or f.session is distinct from p_session or dv is distinct from p_device then raise exception 'forbidden: session'; end if;
  return f;
end $$;

-- Claim the referee device. Returns {control, session}; control=false is view only (another device active in last 30 s)
create function public.a2_ref_claim(p_pin text, p_device text) returns jsonb language plpgsql security definer set search_path=public as $$
declare f a2_field; dv text;
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  select * into f from a2_field where no=1 for update;
  select device into dv from a2_fdev where no=1;
  if dv is not null and dv<>p_device and f.ref_seen is not null and f.ref_seen>now()-interval '30 seconds' then
    return jsonb_build_object('control',false,'session',null);
  end if;
  update a2_fdev set device=p_device where no=1;
  update a2_field set ref_seen=now() where no=1;
  return jsonb_build_object('control',true,'session',f.session);
end $$;

create function public.a2_ref_heartbeat(p_pin text, p_device text) returns boolean language plpgsql security definer set search_path=public as $$
declare dv text;
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  select device into dv from a2_fdev where no=1;
  if dv is distinct from p_device then return false; end if;
  update a2_field set ref_seen=now() where no=1;
  return true;
end $$;

create function public.a2_ref_release(p_pin text, p_device text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  update a2_fdev set device=null where no=1 and device=p_device;
  update a2_field set ref_seen=null, updated_at=now() where no=1;
end $$;

-- Choose field pattern, p_n null = random
create function public.a2_ref_pattern(p_pin text, p_device text, p_session uuid, p_game bigint, p_n int default null) returns a2_game language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  select * into g from a2_game where id=p_game for update;
  if g.id is null or g.match_code is distinct from f.match_code then raise exception 'forbidden: game'; end if;
  if g.status<>'ready' or f.phase<>'idle' then raise exception 'locked: เปลี่ยนแบบสนามไม่ได้แล้ว'; end if;
  if (select x.status from a2_game x where x.match_code=g.match_code and x.idx<g.idx and x.status<>'void' order by x.idx desc limit 1)='replay' then
    raise exception 'locked: เกมแข่งใหม่ ใช้แบบสนามเดิม'; end if;
  if p_n is null then p_n := 1+floor(random()*3)::int; end if;
  if p_n not between 1 and 3 then raise exception 'bad pattern'; end if;
  update a2_game set pattern=p_n, version=version+1, updated_at=now() where id=p_game;
  perform a2_audit('ref:'||left(p_device,6),'game.pattern',g.match_code||'/g'||g.idx,null,to_jsonb(p_n));
  select * into g from a2_game where id=p_game;
  return g;
end $$;

create function public.a2_ref_setup(p_pin text, p_device text, p_session uuid, p_action text) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  if p_action not in ('start','skip') then raise exception 'bad action'; end if;
  perform a2_flow('setup_'||p_action,'ref:'||left(p_device,6),false);
end $$;

create function public.a2_ref_check(p_pin text, p_device text, p_session uuid, p_item text, p_on boolean) returns jsonb language plpgsql security definer set search_path=public as $$
declare f a2_field; r jsonb;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  if p_item not in ('red_in','blue_in','stands') then raise exception 'bad item'; end if;
  if f.phase not in ('idle','setup','ready') then raise exception 'locked: ตรวจรายการก่อนเริ่มไม่ได้แล้ว'; end if;
  update a2_field set checks=checks||jsonb_build_object(p_item,coalesce(p_on,false)), updated_at=now() where no=1 returning checks into r;
  return r;
end $$;

create function public.a2_ref_go(p_pin text, p_device text, p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  perform a2_flow('go','ref:'||left(p_device,6),false);
end $$;

create function public.a2_ref_false_start(p_pin text, p_device text, p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  perform a2_flow('false_start','ref:'||left(p_device,6),false);
end $$;

-- Record an event. p_id is made on the referee device so resends are safe. p_t_ms null = use server time
create function public.a2_ref_mark(p_pin text, p_device text, p_session uuid, p_game bigint, p_id uuid, p_kind text, p_side text, p_t_ms int default null) returns a2_game
language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; ev a2_event; t int; src text; cur int; actor text;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  actor := 'ref:'||left(p_device,6);
  select * into g from a2_game where id=p_game for update;
  if g.id is null or g.match_code is distinct from f.match_code then raise exception 'forbidden: game'; end if;
  if p_id is not null and exists(select 1 from a2_mark where id=p_id) then return g; end if;
  if g.status not in ('live','review') then raise exception 'locked: เกมไม่ได้กำลังแข่ง'; end if;
  if p_kind not in ('exit_first','lift_first','park','unpark','complete','retry') then raise exception 'bad kind'; end if;
  if not (p_side in ('red','blue') or (p_side='both' and p_kind in ('exit_first','lift_first','complete'))) then raise exception 'bad side'; end if;
  if p_kind='complete' and g.status<>'live' then raise exception 'locked: Mission complete ต้องกดระหว่างเกม'; end if;
  select * into ev from a2_event;
  t := least(ev.game_ms, greatest(0, coalesce(p_t_ms, a2_elapsed(f))));
  src := case when g.status='review' then 'review' else 'live' end;
  if p_kind in ('park','unpark') then
    cur := case when p_side='red' then g.red_parked else g.blue_parked end;
    if p_kind='park' and cur>=3 then raise exception 'locked: ครบ 3 แท่นแล้ว'; end if;
    if p_kind='unpark' and cur<=0 then raise exception 'locked: ไม่มีแท่นให้ลด'; end if;
  end if;
  begin
    insert into a2_mark(id,game_id,kind,side,t_ms,source,device) values (coalesce(p_id,gen_random_uuid()),p_game,p_kind,p_side,t,src,actor);
  exception when unique_violation then
    raise exception 'locked: บันทึกข้อนี้แล้ว ถ้าจะแก้ให้กดย้อนก่อน';
  end;
  if p_kind='complete' then
    update a2_field set phase='stopped', running=false, ends_at=null, left_ms=ev.game_ms-t, stop_ms=t, updated_at=now() where no=1;
    update a2_game set status='review' where id=p_game;
  end if;
  perform a2_sum(p_game);
  select * into g from a2_game where id=p_game;
  perform a2_audit(actor,'mark.'||p_kind,g.match_code||'/g'||g.idx,null,jsonb_build_object('side',p_side,'t_ms',t));
  return g;
end $$;

create function public.a2_ref_undo(p_pin text, p_device text, p_session uuid, p_id uuid) returns a2_game language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; mk a2_mark; ev a2_event; ends timestamptz;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  select * into mk from a2_mark where id=p_id;
  if mk.id is null then raise exception 'locked: ไม่พบรายการ'; end if;
  select * into g from a2_game where id=mk.game_id for update;
  if g.match_code is distinct from f.match_code or g.status not in ('live','review') then raise exception 'locked: ย้อนไม่ได้แล้ว'; end if;
  if mk.voided or mk.kind='false_start' then return g; end if;
  update a2_mark set voided=true where id=p_id;
  if mk.kind='complete' and f.phase='stopped' then
    select * into ev from a2_event;
    ends := f.go_at+make_interval(secs=>ev.game_ms/1000.0);
    if ends>now() then
      update a2_field set phase='game', running=true, ends_at=ends, left_ms=null, stop_ms=null, updated_at=now() where no=1;
      update a2_game set status='live' where id=g.id;
    else
      update a2_field set phase='over', running=false, ends_at=null, left_ms=0, stop_ms=ev.game_ms, updated_at=now() where no=1;
    end if;
  end if;
  perform a2_sum(g.id);
  perform a2_audit('ref:'||left(p_device,6),'mark.undo',g.match_code||'/g'||g.idx,to_jsonb(mk),null);
  select * into g from a2_game where id=g.id;
  return g;
end $$;

create function public.a2_ref_confirm(p_pin text, p_device text, p_session uuid, p_game bigint) returns text language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; r text;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  select * into g from a2_game where id=p_game for update;
  if g.match_code is distinct from f.match_code or g.status<>'review' then raise exception 'locked: รับรองผลไม่ได้'; end if;
  r := a2_close_game(p_game,'ref:'||left(p_device,6));
  perform a2_audit('ref:'||left(p_device,6),'game.confirm',g.match_code||'/g'||g.idx,null,jsonb_build_object('result',r));
  return r;
end $$;

create function public.a2_ref_judge(p_pin text, p_device text, p_session uuid, p_game bigint, p_side text) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  select * into g from a2_game where id=p_game for update;
  if g.match_code is distinct from f.match_code or g.status<>'review' or g.need is distinct from 'judge' then raise exception 'locked: ไม่ต้องตัดสิน'; end if;
  if p_side not in ('red','blue') then raise exception 'bad side'; end if;
  update a2_game set status='done', winner=p_side, method='judge', decided_by='referee', need=null, version=version+1, updated_at=now() where id=p_game;
  perform a2_recompute();
  perform a2_ensure_game(g.match_code);
  update a2_field set phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=1;
  perform a2_audit('ref:'||left(p_device,6),'game.judge',g.match_code||'/g'||g.idx,null,jsonb_build_object('side',p_side));
end $$;

-- Absent request, p_side null = cancel
create function public.a2_ref_absent(p_pin text, p_device text, p_session uuid, p_side text) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  f := a2_ref_auth(p_pin,p_device,p_session);
  if p_side is not null and p_side not in ('red','blue') then raise exception 'bad side'; end if;
  if f.phase not in ('idle','setup','ready') then raise exception 'locked: ขอแพ้บายตอนนี้ไม่ได้'; end if;
  update a2_match set absent_req=p_side, updated_at=now() where code=f.match_code;
  perform a2_audit('ref:'||left(p_device,6),'match.absent_req',f.match_code,null,to_jsonb(p_side));
end $$;

-- ===== 9. Admin =====
create function public.a2_do_call(p_code text, p_actor text) returns void language plpgsql security definer set search_path=public as $$
declare m a2_match; f a2_field;
begin
  select * into m from a2_match where code=p_code; if not found then raise exception 'no such match'; end if;
  if m.status<>'ready' then raise exception 'match not ready: %', m.status; end if;
  select * into f from a2_field where no=1 for update;
  if f.match_code is not null and exists(select 1 from a2_match where code=f.match_code and status<>'done') then raise exception 'field busy'; end if;
  update a2_match set field_no=null where code=f.match_code;
  update a2_field set match_code=p_code, session=gen_random_uuid(), phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=1;
  update a2_match set field_no=1, updated_at=now() where code=p_code;
  perform a2_recompute();
  perform a2_ensure_game(p_code);
  perform a2_audit(p_actor,'queue.call',p_code,null,null);
end $$;

create function public.a2_adm_call(p_pw text, p_code text) returns void language plpgsql security definer set search_path=public as $$
begin perform a2_need_admin(p_pw); perform a2_do_call(p_code,'admin'); end $$;

create function public.a2_adm_clear(p_pw text) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  perform a2_need_admin(p_pw);
  select * into f from a2_field where no=1 for update;
  update a2_match set field_no=null where code=f.match_code;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=1;
  delete from a2_game where match_code=f.match_code and status='ready' and idx=(select max(idx) from a2_game where match_code=f.match_code)
    and not exists(select 1 from a2_game x where x.match_code=f.match_code and x.status in ('done','replay'));
  perform a2_recompute();
  perform a2_audit('admin','queue.clear',null,null,to_jsonb(f.match_code));
end $$;

-- Admin control in place of referee. p_action: setup_start setup_skip go false_start reset
create function public.a2_adm_timer(p_pw text, p_action text) returns void language plpgsql security definer set search_path=public as $$
begin perform a2_need_admin(p_pw); perform a2_flow(p_action,'admin',true); end $$;

create function public.a2_adm_ref_transfer(p_pw text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  update a2_fdev set device=null where no=1;
  update a2_field set ref_seen=null, updated_at=now() where no=1;
  perform a2_audit('admin','ref.transfer',null,null,null);
end $$;

-- Edit event log. p_op: add void unvoid edit
create function public.a2_adm_mark(p_pw text, p_game bigint, p_op text, p_id uuid default null, p_kind text default null, p_side text default null, p_t_ms int default null) returns a2_game
language plpgsql security definer set search_path=public as $$
declare g a2_game; ev a2_event; d record; before jsonb;
begin
  perform a2_need_admin(p_pw);
  select * into g from a2_game where id=p_game for update;
  if g.id is null then raise exception 'no game'; end if;
  select * into ev from a2_event;
  before := to_jsonb(g);
  begin
    if p_op='add' then
      if p_kind not in ('exit_first','lift_first','park','unpark','complete','retry') then raise exception 'bad kind'; end if;
      if p_side not in ('red','blue','both') or (p_side='both' and p_kind not in ('exit_first','lift_first','complete')) then raise exception 'bad side'; end if;
      insert into a2_mark(id,game_id,kind,side,t_ms,source,device) values (coalesce(p_id,gen_random_uuid()),p_game,p_kind,p_side,least(ev.game_ms,greatest(0,coalesce(p_t_ms,0))),'admin','admin');
    elsif p_op='void' then update a2_mark set voided=true where id=p_id and game_id=p_game;
    elsif p_op='unvoid' then update a2_mark set voided=false where id=p_id and game_id=p_game;
    elsif p_op='edit' then
      update a2_mark set side=coalesce(p_side,side), t_ms=case when p_t_ms is null then t_ms else least(ev.game_ms,greatest(0,p_t_ms)) end where id=p_id and game_id=p_game;
    else raise exception 'bad op'; end if;
  exception when unique_violation then
    raise exception 'locked: เกมนี้มีรายการประเภทนี้อยู่แล้ว ให้ลบหรือแก้รายการเดิม';
  end;
  perform a2_sum(p_game);
  select * into g from a2_game where id=p_game;
  if g.status='done' and g.decided_by='auto' then   -- recompute result from events
    select * into d from a2_decide(g);
    if d.side is not null then update a2_game set winner=d.side, method=d.method where id=p_game;
    else update a2_game set status='review', winner=null, method=null, decided_by=null, need=d.need where id=p_game; end if;
  end if;
  perform a2_recompute();
  select * into g from a2_game where id=p_game;
  perform a2_audit('admin','mark.'||p_op,g.match_code||'/g'||g.idx,before,to_jsonb(g));
  return g;
end $$;

create or replace function public.a2_adm_game(p_pw text, p_game bigint, p jsonb, p_version int default null) returns a2_game language plpgsql security definer set search_path=public as $$
declare g a2_game; before jsonb; d record;
begin
  perform a2_need_admin(p_pw);
  select * into g from a2_game where id=p_game for update;
  if g.id is null then raise exception 'no game'; end if;
  if p_version is not null and p_version<>g.version then raise exception 'stale: ข้อมูลเปลี่ยนไปแล้ว'; end if;
  before := to_jsonb(g);
  update a2_game set
    pattern=case when p ? 'pattern' then nullif(p->>'pattern','')::int else pattern end,
    note=case when p ? 'note' then p->>'note' else note end,
    version=version+1, updated_at=now() where id=p_game;
  if p ? 'winner' then
    if nullif(p->>'winner','') is null then
      update a2_game set winner=null, method=null, decided_by=null, status=case when status='done' then 'review' else status end where id=p_game;
    else
      select * into g from a2_game where id=p_game;
      select * into d from a2_decide(g);
      update a2_game set winner=p->>'winner', method=case when d.side=p->>'winner' then d.method else 'judge' end, decided_by='admin', status='done', need=null where id=p_game;
    end if;
  elsif p ? 'auto' then
    perform a2_close_game(p_game,'admin');
  end if;
  perform a2_recompute();
  select * into g from a2_game where id=p_game;
  perform a2_ensure_game(g.match_code);
  perform a2_audit('admin','game.patch',g.match_code||'/g'||g.idx,before,to_jsonb(g));
  select * into g from a2_game where id=p_game;
  return g;
end $$;

-- Approve forfeit, p_side null = cancel (also clears request)
create or replace function public.a2_adm_forfeit(p_pw text, p_code text, p_side text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  if p_side is not null and p_side not in ('red','blue') then raise exception 'bad side'; end if;
  if p_side is not null and exists(select 1 from a2_match where code=p_code and (red_seed is null or blue_seed is null)) then
    raise exception 'locked: คู่นี้ยังไม่รู้ผู้เล่นครบ'; end if;
  update a2_match set forfeit=p_side, absent_req=null where code=p_code;
  perform a2_recompute();
  perform a2_audit('admin','match.forfeit',p_code,null,to_jsonb(p_side));
end $$;

create or replace function public.a2_adm_event(p_pw text, p jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  update a2_event set
    name=coalesce(p->>'name',name), setup_ms=coalesce((p->>'setup_ms')::int,setup_ms), game_ms=coalesce((p->>'game_ms')::int,game_ms),
    countdown_ms=coalesce((p->>'countdown_ms')::int,countdown_ms), tv_mode=coalesce(p->>'tv_mode',tv_mode),
    tv_focus=case when p ? 'tv_focus' then nullif(p->>'tv_focus','')::int else tv_focus end,
    draw_state=case when p ? 'draw_state' then p->'draw_state' else draw_state end, updated_at=now();
  if p ? 'new_pw' then update a2_secret set admin_hash=a2_hash(p->>'new_pw'); end if;
  if p ? 'new_pin' then update a2_secret set ref_hash=a2_hash(p->>'new_pin'); end if;
  perform a2_audit('admin','event.update',null,null,p - 'new_pw' - 'new_pin');
end $$;

create or replace function public.a2_adm_schedule(p_pw text, p_items jsonb) returns void language plpgsql security definer set search_path=public as $$
declare it jsonb;
begin
  perform a2_need_admin(p_pw);
  for it in select * from jsonb_array_elements(p_items) loop
    update a2_match set sched_at=nullif(it->>'at','')::timestamptz, auto_open=coalesce((it->>'auto')::boolean,false), updated_at=now() where code=it->>'code';
  end loop;
  perform a2_audit('admin','schedule.set',null,null,p_items);
end $$;

create or replace function public.a2_adm_reset(p_pw text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  delete from a2_game; delete from a2_tiebreak;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, ref_seen=null, updated_at=now();
  update a2_fdev set device=null;
  update a2_team set absent=false;
  update a2_match set field_no=null, sched_at=null, auto_open=false, forfeit=null, walkover=null, absent_req=null, red_wins=0, blue_wins=0, winner_seed=null, red_seed=null, blue_seed=null, status='locked';
  update a2_event set draw_state=null, tv_mode='auto';
  perform a2_recompute();
  perform a2_audit('admin','reset',null,null,null);
end $$;

-- ===== 10. tick: advance time and call scheduled match when field is free =====
create or replace function public.a2_tick() returns void language plpgsql security definer set search_path=public as $$
declare f a2_field; m record;
begin
  perform a2_sync();
  select * into f from a2_field where no=1;
  if f.match_code is null or exists(select 1 from a2_match y where y.code=f.match_code and y.status='done') then
    select code into m from a2_match where auto_open and sched_at<=now() and status='ready' order by sched_at, order_no limit 1;
    if found then
      begin perform a2_do_call(m.code,'system:auto'); exception when others then null; end;
    end if;
  end if;
end $$;

-- ===== 11. Privileges =====
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'a2\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and ((p.proname like 'a2\_adm\_%' or p.proname like 'a2\_ref\_%') and p.proname<>'a2_ref_auth'
      or p.proname in ('a2_setup','a2_has_setup','a2_admin_login','a2_now','a2_tick','a2_table','a2_place','a2_slot_seed')) loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;
