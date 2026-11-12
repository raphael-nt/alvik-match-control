
create function public.a2_close_game(p_game bigint, p_actor text) returns text language plpgsql security definer set search_path=public as $$
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
    update a2_field set phase='idle', running=false, ends_at=null, left_ms=null, updated_at=now() where no=f.no;
  end if;
  return coalesce(d.side,'replay');
end $$;

create function public.a2_ref_login(p_pin text) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from a2_secret where ref_hash=a2_hash(p_pin)) $$;

create function public.a2_ref_claim(p_pin text, p_device text, p_field int) returns uuid language plpgsql security definer set search_path=public as $$
declare f a2_field; dv text;
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  select * into f from a2_field where no=p_field for update;
  if f.match_code is null then raise exception 'not_open: ยังไม่เปิดคิว'; end if;
  select device into dv from a2_fdev where no=p_field;
  if dv is not null and dv<>p_device and f.ref_seen is not null and f.ref_seen>now()-interval '30 seconds' then
    raise exception 'taken: เครื่องอื่นใช้สนามนี้อยู่'; end if;
  update a2_fdev set device=p_device where no=p_field;
  update a2_field set ref_seen=now(), updated_at=now() where no=p_field;
  return f.session;
end $$;

create function public.a2_ref_check(p_pin text, p_device text, p_field int, p_session uuid) returns a2_field language plpgsql security definer set search_path=public as $$
declare f a2_field; dv text;
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  select * into f from a2_field where no=p_field for update;
  select device into dv from a2_fdev where no=p_field;
  if f.match_code is null or f.session is distinct from p_session or dv is distinct from p_device then raise exception 'forbidden: session'; end if;
  return f;
end $$;

create function public.a2_ref_heartbeat(p_pin text, p_device text, p_field int, p_session uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  f := a2_ref_check(p_pin,p_device,p_field,p_session);
  update a2_field set ref_seen=now() where no=p_field;
  return true;
end $$;

create function public.a2_ref_release(p_pin text, p_device text, p_field int) returns void language plpgsql security definer set search_path=public as $$
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  update a2_fdev set device=null where no=p_field and device=p_device;
  update a2_field set ref_seen=null, updated_at=now() where no=p_field;
end $$;

create function public.a2_timer_do(f a2_field, p_action text, p_actor text) returns void language plpgsql security definer set search_path=public as $$
declare ev a2_event; g a2_game; rem int;
begin
  select * into ev from a2_event;
  select * into g from a2_game where match_code=f.match_code and status in ('ready','live','review') order by idx desc limit 1;
  if p_action='start_setup' then
    if g.id is null or g.status<>'ready' then raise exception 'no game ready'; end if;
    if g.pattern is null then raise exception 'pattern: เลือกแบบสนามก่อน'; end if;
    update a2_field set phase='setup', running=true, ends_at=now()+make_interval(secs=>ev.setup_ms/1000.0), left_ms=null, updated_at=now() where no=f.no;
  elsif p_action='start_game' then
    if g.id is null or g.status<>'ready' then raise exception 'no game ready'; end if;
    if g.pattern is null then raise exception 'pattern: เลือกแบบสนามก่อน'; end if;
    update a2_field set phase='game', running=true, ends_at=now()+make_interval(secs=>ev.game_ms/1000.0), left_ms=null, updated_at=now() where no=f.no;
    update a2_game set status='live', version=version+1, updated_at=now() where id=g.id;
    update a2_match set status='live', updated_at=now() where code=f.match_code;
  elsif p_action='pause' then
    if f.running then
      rem := greatest(0,(extract(epoch from (f.ends_at-now()))*1000)::int);
      update a2_field set running=false, ends_at=null, left_ms=rem, updated_at=now() where no=f.no;
    end if;
  elsif p_action='resume' then
    if not f.running and f.phase in ('setup','game') and coalesce(f.left_ms,0)>0 then
      update a2_field set running=true, ends_at=now()+make_interval(secs=>f.left_ms/1000.0), left_ms=null, updated_at=now() where no=f.no;
    end if;
  elsif p_action='reset' then
    update a2_field set phase='idle', running=false, ends_at=null, left_ms=null, updated_at=now() where no=f.no;
    update a2_game set status='ready', red_parked=0, blue_parked=0, red_full_ms=null, blue_full_ms=null, red_lift_ms=null, blue_lift_ms=null, red_exit_ms=null, blue_exit_ms=null, need=null, version=version+1, updated_at=now()
      where id=g.id and status in ('live','review');
  else raise exception 'bad action'; end if;
  perform a2_audit(p_actor,'timer.'||p_action,'field'||f.no,null,null);
end $$;

create function public.a2_ref_timer(p_pin text, p_device text, p_field int, p_session uuid, p_action text) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  f := a2_ref_check(p_pin,p_device,p_field,p_session);
  perform a2_timer_do(f,p_action,'ref:'||left(p_device,6)||'@'||p_field);
end $$;

create function public.a2_ref_op(p_pin text, p_device text, p_field int, p_session uuid, p_game bigint, p_op text, p_side text default null, p_arg int default null) returns a2_game
language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; el int; before jsonb;
begin
  f := a2_ref_check(p_pin,p_device,p_field,p_session);
  select * into g from a2_game where id=p_game for update;
  if g.id is null or g.match_code is distinct from f.match_code then raise exception 'forbidden: game'; end if;
  before := to_jsonb(g);
  if p_op='pattern' then
    if g.status<>'ready' then raise exception 'locked: เปลี่ยนแบบสนามไม่ได้แล้ว'; end if;
    if p_arg not between 1 and 3 then raise exception 'bad pattern'; end if;
    update a2_game set pattern=p_arg, version=version+1, updated_at=now() where id=p_game;
  else
    if g.status<>'live' then raise exception 'locked: เกมไม่ได้กำลังแข่ง'; end if;
    if p_side not in ('red','blue') then raise exception 'bad side'; end if;
    el := coalesce(p_arg, a2_elapsed(f));
    if p_op='parked_inc' then
      if (case when p_side='red' then g.red_parked else g.blue_parked end)>=3 then raise exception 'locked: ครบ 3 แท่นแล้ว'; end if;
      if p_side='red' then
        update a2_game set red_parked=red_parked+1, red_full_ms=case when red_parked+1=3 then el else red_full_ms end, version=version+1, updated_at=now() where id=p_game;
      else
        update a2_game set blue_parked=blue_parked+1, blue_full_ms=case when blue_parked+1=3 then el else blue_full_ms end, version=version+1, updated_at=now() where id=p_game;
      end if;
    elsif p_op='parked_dec' then
      if p_side='red' then update a2_game set red_parked=greatest(0,red_parked-1), red_full_ms=null, version=version+1, updated_at=now() where id=p_game;
      else update a2_game set blue_parked=greatest(0,blue_parked-1), blue_full_ms=null, version=version+1, updated_at=now() where id=p_game; end if;
    elsif p_op='lift' then
      if p_side='red' then update a2_game set red_lift_ms=coalesce(red_lift_ms,el), version=version+1, updated_at=now() where id=p_game;
      else update a2_game set blue_lift_ms=coalesce(blue_lift_ms,el), version=version+1, updated_at=now() where id=p_game; end if;
    elsif p_op='exit' then
      if p_side='red' then update a2_game set red_exit_ms=coalesce(red_exit_ms,el), version=version+1, updated_at=now() where id=p_game;
      else update a2_game set blue_exit_ms=coalesce(blue_exit_ms,el), version=version+1, updated_at=now() where id=p_game; end if;
    elsif p_op='clear_lift' then
      if p_side='red' then update a2_game set red_lift_ms=null, version=version+1, updated_at=now() where id=p_game;
      else update a2_game set blue_lift_ms=null, version=version+1, updated_at=now() where id=p_game; end if;
    elsif p_op='clear_exit' then
      if p_side='red' then update a2_game set red_exit_ms=null, version=version+1, updated_at=now() where id=p_game;
      else update a2_game set blue_exit_ms=null, version=version+1, updated_at=now() where id=p_game; end if;
    else raise exception 'bad op'; end if;
    select * into g from a2_game where id=p_game;
    if g.red_parked>=3 and g.blue_parked>=3 then
      update a2_field set phase='over', running=false, ends_at=null, left_ms=0, updated_at=now() where no=p_field;
      update a2_game set status='review', version=version+1, updated_at=now() where id=p_game;
    end if;
  end if;
  select * into g from a2_game where id=p_game;
  perform a2_audit('ref:'||left(p_device,6)||'@'||p_field,'game.'||p_op,g.match_code||'/g'||g.idx,before,to_jsonb(g));
  update a2_match set updated_at=now() where code=g.match_code;
  return g;
end $$;

create function public.a2_ref_finish(p_pin text, p_device text, p_field int, p_session uuid, p_game bigint) returns text
language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game; r text;
begin
  f := a2_ref_check(p_pin,p_device,p_field,p_session);
  select * into g from a2_game where id=p_game for update;
  if g.match_code is distinct from f.match_code or g.status not in ('live','review') then raise exception 'locked: จบเกมไม่ได้'; end if;
  if g.status='live' then update a2_game set status='review' where id=p_game; end if;
  r := a2_close_game(p_game,'ref:'||left(p_device,6)||'@'||p_field);
  perform a2_audit('ref:'||left(p_device,6)||'@'||p_field,'game.finish',g.match_code||'/g'||g.idx,null,jsonb_build_object('result',r));
  return r;
end $$;

create function public.a2_ref_judge(p_pin text, p_device text, p_field int, p_session uuid, p_game bigint, p_side text) returns void
language plpgsql security definer set search_path=public as $$
declare f a2_field; g a2_game;
begin
  f := a2_ref_check(p_pin,p_device,p_field,p_session);
  select * into g from a2_game where id=p_game for update;
  if g.match_code is distinct from f.match_code or g.status<>'review' or g.need is distinct from 'judge' then raise exception 'locked: ไม่ต้องตัดสิน'; end if;
  if p_side not in ('red','blue') then raise exception 'bad side'; end if;
  update a2_game set status='done', winner=p_side, method='judge', decided_by='referee', need=null, version=version+1, updated_at=now() where id=p_game;
  perform a2_recompute();
  perform a2_ensure_game(g.match_code);
  update a2_field set phase='idle', running=false, ends_at=null, left_ms=null, updated_at=now() where no=p_field;
  perform a2_audit('ref:'||left(p_device,6)||'@'||p_field,'game.judge',g.match_code||'/g'||g.idx,null,jsonb_build_object('side',p_side));
end $$;

-- ===== admin =====
create function public.a2_setup(p_pw text, p_pin text) returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from a2_secret) then raise exception 'forbidden: already set'; end if;
  if length(coalesce(p_pw,''))<6 or length(coalesce(p_pin,''))<4 then raise exception 'weak: รหัสสั้นเกินไป'; end if;
  insert into a2_secret(admin_hash,ref_hash) values (a2_hash(p_pw),a2_hash(p_pin));
end $$;
create function public.a2_has_setup() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from a2_secret) $$;
create function public.a2_admin_login(p_pw text) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from a2_secret where admin_hash=a2_hash(p_pw)) $$;
create function public.a2_now() returns bigint language sql stable as $$ select (extract(epoch from clock_timestamp())*1000)::bigint $$;

create function public.a2_adm_event(p_pw text, p jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  update a2_event set
    name=coalesce(p->>'name',name), setup_ms=coalesce((p->>'setup_ms')::int,setup_ms), game_ms=coalesce((p->>'game_ms')::int,game_ms),
    field_count=coalesce((p->>'field_count')::int,field_count), tv_mode=coalesce(p->>'tv_mode',tv_mode),
    tv_focus=case when p ? 'tv_focus' then nullif(p->>'tv_focus','')::int else tv_focus end,
    draw_state=case when p ? 'draw_state' then p->'draw_state' else draw_state end, updated_at=now();
  if p ? 'new_pw' then update a2_secret set admin_hash=a2_hash(p->>'new_pw'); end if;
  if p ? 'new_pin' then update a2_secret set ref_hash=a2_hash(p->>'new_pin'); end if;
  perform a2_audit('admin','event.update',null,null,p - 'new_pw' - 'new_pin');
end $$;

create function public.a2_adm_teams(p_pw text, p_names text[]) returns void language plpgsql security definer set search_path=public as $$
declare i int;
begin
  perform a2_need_admin(p_pw);
  for i in 1..9 loop update a2_team set name=coalesce(p_names[i],''), updated_at=now() where seed=i; end loop;
  perform a2_audit('admin','teams.set',null,null,to_jsonb(p_names));
end $$;

create function public.a2_adm_assign(p_pw text, p_code text, p_field int) returns void language plpgsql security definer set search_path=public as $$
begin perform a2_need_admin(p_pw); perform a2_do_assign(p_code,p_field,'admin'); end $$;

create function public.a2_adm_unassign(p_pw text, p_field int) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  perform a2_need_admin(p_pw);
  select * into f from a2_field where no=p_field for update;
  update a2_match set field_no=null where code=f.match_code;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, ref_seen=null, updated_at=now() where no=p_field;
  update a2_fdev set device=null where no=p_field;
  delete from a2_game where match_code=f.match_code and status='ready' and idx=(select max(idx) from a2_game where match_code=f.match_code) and red_parked=0 and blue_parked=0 and not exists(select 1 from a2_game x where x.match_code=f.match_code and x.status in ('done','replay'));
  perform a2_recompute();
  perform a2_audit('admin','queue.unassign','field'||p_field,null,to_jsonb(f.match_code));
end $$;

create function public.a2_adm_timer(p_pw text, p_field int, p_action text) returns void language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  perform a2_need_admin(p_pw);
  select * into f from a2_field where no=p_field for update;
  if f.match_code is null then raise exception 'field empty'; end if;
  perform a2_timer_do(f,p_action,'admin');
end $$;

create function public.a2_adm_game(p_pw text, p_game bigint, p jsonb, p_version int default null) returns a2_game language plpgsql security definer set search_path=public as $$
declare g a2_game; before jsonb; k text;
begin
  perform a2_need_admin(p_pw);
  select * into g from a2_game where id=p_game for update;
  if g.id is null then raise exception 'no game'; end if;
  if p_version is not null and p_version<>g.version then raise exception 'stale: ข้อมูลเปลี่ยนไปแล้ว'; end if;
  before := to_jsonb(g);
  update a2_game set
    pattern=case when p ? 'pattern' then nullif(p->>'pattern','')::int else pattern end,
    red_parked=case when p ? 'red_parked' then (p->>'red_parked')::int else red_parked end,
    blue_parked=case when p ? 'blue_parked' then (p->>'blue_parked')::int else blue_parked end,
    red_full_ms=case when p ? 'red_full_ms' then nullif(p->>'red_full_ms','')::int else red_full_ms end,
    blue_full_ms=case when p ? 'blue_full_ms' then nullif(p->>'blue_full_ms','')::int else blue_full_ms end,
    red_lift_ms=case when p ? 'red_lift_ms' then nullif(p->>'red_lift_ms','')::int else red_lift_ms end,
    blue_lift_ms=case when p ? 'blue_lift_ms' then nullif(p->>'blue_lift_ms','')::int else blue_lift_ms end,
    red_exit_ms=case when p ? 'red_exit_ms' then nullif(p->>'red_exit_ms','')::int else red_exit_ms end,
    blue_exit_ms=case when p ? 'blue_exit_ms' then nullif(p->>'blue_exit_ms','')::int else blue_exit_ms end,
    note=case when p ? 'note' then p->>'note' else note end,
    version=version+1, updated_at=now() where id=p_game;
  if p ? 'winner' then
    if nullif(p->>'winner','') is null then
      update a2_game set winner=null, method=null, decided_by=null, status=case when status='done' then 'review' else status end where id=p_game;
    else
      update a2_game set winner=p->>'winner', method=coalesce((select d.method from a2_decide(a2_game) d where d.side=p->>'winner'),'judge'), decided_by='admin', status='done', need=null where id=p_game;
    end if;
  elsif p ? 'auto' then
    select * into g from a2_game where id=p_game;
    perform a2_close_game(p_game,'admin');
  end if;
  perform a2_recompute();
  select * into g from a2_game where id=p_game;
  perform a2_ensure_game(g.match_code);
  perform a2_audit('admin','game.patch',g.match_code||'/g'||g.idx,before,to_jsonb(g));
  select * into g from a2_game where id=p_game;
  return g;
end $$;

create function public.a2_adm_game_add(p_pw text, p_code text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  insert into a2_game(match_code,idx) values (p_code,(select coalesce(max(idx),0)+1 from a2_game where match_code=p_code));
  perform a2_audit('admin','game.add',p_code,null,null);
end $$;

create function public.a2_adm_game_void(p_pw text, p_game bigint) returns void language plpgsql security definer set search_path=public as $$
declare g a2_game;
begin
  perform a2_need_admin(p_pw);
  select * into g from a2_game where id=p_game;
  update a2_game set status='void', winner=null, version=version+1, updated_at=now() where id=p_game;
  perform a2_recompute(); perform a2_ensure_game(g.match_code);
  perform a2_audit('admin','game.void',g.match_code||'/g'||g.idx,to_jsonb(g),null);
end $$;

create function public.a2_adm_swap(p_pw text, p_code text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  if exists(select 1 from a2_game where match_code=p_code and status<>'void') then raise exception 'locked: มีเกมแล้ว สลับฝั่งไม่ได้'; end if;
  update a2_match set red_src=blue_src, blue_src=red_src where code=p_code;
  perform a2_recompute();
  perform a2_audit('admin','match.swap',p_code,null,null);
end $$;

create function public.a2_adm_tiebreak(p_pw text, p_grp text, p_seeds int[]) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  if p_seeds is null then delete from a2_tiebreak where grp=p_grp;
  else insert into a2_tiebreak values (p_grp,p_seeds) on conflict (grp) do update set seeds=excluded.seeds; end if;
  perform a2_recompute();
  perform a2_audit('admin','group.tiebreak',p_grp,null,to_jsonb(p_seeds));
end $$;

create function public.a2_adm_schedule(p_pw text, p_items jsonb) returns void language plpgsql security definer set search_path=public as $$
declare it jsonb;
begin
  perform a2_need_admin(p_pw);
  for it in select * from jsonb_array_elements(p_items) loop
    update a2_match set sched_at=nullif(it->>'at','')::timestamptz, sched_field=nullif(it->>'field','')::int,
      auto_open=coalesce((it->>'auto')::boolean,false), updated_at=now() where code=it->>'code';
  end loop;
  perform a2_audit('admin','schedule.set',null,null,p_items);
end $$;

create function public.a2_adm_reset(p_pw text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  delete from a2_game; delete from a2_tiebreak;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, ref_seen=null, updated_at=now();
  update a2_fdev set device=null;
  update a2_match set field_no=null, sched_at=null, sched_field=null, auto_open=false, red_wins=0, blue_wins=0, winner_seed=null, red_seed=null, blue_seed=null, status='locked';
  update a2_event set draw_state=null, tv_mode='auto';
  perform a2_recompute();
  perform a2_audit('admin','reset',null,null,null);
end $$;

create function public.a2_adm_audit(p_pw text, p_limit int default 200) returns setof a2_audit language plpgsql security definer set search_path=public as $$
begin perform a2_need_admin(p_pw); return query select * from a2_audit order by id desc limit least(p_limit,1000); end $$;

-- ===== views =====
create view public.a2_v_standings as
  select 'A'::text grp, t.* from a2_table('A') t union all select 'B', t.* from a2_table('B') t
  union all select 'C', t.* from a2_table('C') t union all select 'D', t.* from a2_table('D') t union all select 'E', t.* from a2_table('E') t;

create view public.a2_v_ranking as
  select 1 pos, '1'::text label, winner_seed seed from a2_match where code='F'
  union all select 2,'2', case when winner_seed=red_seed then blue_seed else red_seed end from a2_match where code='F' and winner_seed is not null
  union all select 3,'3=', a2_place('D',2) union all select 3,'3=', a2_place('E',2)
  union all select 5,'5=', a2_place('D',3) union all select 5,'5=', a2_place('E',3)
  union all select 7,'7=', a2_place('A',3) union all select 7,'7=', a2_place('B',3) union all select 7,'7=', a2_place('C',3);

-- ===== grants =====
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'a2\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and (p.proname like 'a2\_adm\_%' or p.proname like 'a2\_ref\_%' and p.proname not in ('a2_ref_check')
      or p.proname in ('a2_setup','a2_has_setup','a2_admin_login','a2_now','a2_tick')) loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;
grant select on public.a2_v_standings, public.a2_v_ranking to anon, authenticated;
