-- Forfeit (team absent)
-- a2_match.forfeit  side set to forfeit for one match ('red' or 'blue')
-- a2_match.walkover side that actually forfeits, computed from forfeit or the team's absent flag
-- a2_team.absent    team absent, forfeits every remaining match
alter table a2_match add column if not exists forfeit text check (forfeit in ('red','blue'));
alter table a2_match add column if not exists walkover text check (walkover in ('red','blue'));
alter table a2_team add column if not exists absent boolean not null default false;

create or replace function public.a2_recompute()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare i int;
begin
  for i in 1..4 loop
    update a2_match set red_seed=a2_slot_seed(red_src), blue_seed=a2_slot_seed(blue_src);
    update a2_match mm set walkover = case
      when mm.red_seed is null or mm.blue_seed is null then null
      else coalesce(mm.forfeit,
        case when coalesce((select absent from a2_team where seed=mm.red_seed),false) and not coalesce((select absent from a2_team where seed=mm.blue_seed),false) then 'red'
             when coalesce((select absent from a2_team where seed=mm.blue_seed),false) and not coalesce((select absent from a2_team where seed=mm.red_seed),false) then 'blue' end)
      end;
    update a2_match mm set
      red_wins = case mm.walkover when 'red' then 0 when 'blue' then (mm.bo+1)/2
                 else (select count(*) from a2_game g where g.match_code=mm.code and g.status='done' and g.winner='red') end,
      blue_wins = case mm.walkover when 'blue' then 0 when 'red' then (mm.bo+1)/2
                 else (select count(*) from a2_game g where g.match_code=mm.code and g.status='done' and g.winner='blue') end;
    update a2_match set winner_seed = case when red_wins>=(bo+1)/2 then red_seed when blue_wins>=(bo+1)/2 then blue_seed end;
    update a2_match mm set status = case
      when winner_seed is not null then 'done'
      when field_no is not null then (case when exists(select 1 from a2_game g where g.match_code=mm.code and g.status in ('live','review','done')) then 'live' else 'queued' end)
      when red_seed is not null and blue_seed is not null then 'ready' else 'locked' end;
  end loop;
  update a2_match set updated_at=now();
end $function$;

create or replace function public.a2_adm_forfeit(p_pw text, p_code text, p_side text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform a2_need_admin(p_pw);
  if p_side is not null and p_side not in ('red','blue') then raise exception 'bad side'; end if;
  if p_side is not null and exists(select 1 from a2_match where code=p_code and (red_seed is null or blue_seed is null)) then
    raise exception 'locked: คู่นี้ยังไม่รู้ผู้เล่นครบ'; end if;
  update a2_match set forfeit=p_side where code=p_code;
  perform a2_recompute();
  perform a2_audit('admin','match.forfeit',p_code,null,to_jsonb(p_side));
end $function$;

create or replace function public.a2_adm_absent(p_pw text, p_seed integer, p_absent boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform a2_need_admin(p_pw);
  update a2_team set absent=coalesce(p_absent,false), updated_at=now() where seed=p_seed;
  perform a2_recompute();
  perform a2_audit('admin','team.absent','seed'||p_seed,null,to_jsonb(coalesce(p_absent,false)));
end $function$;

create or replace function public.a2_adm_reset(p_pw text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform a2_need_admin(p_pw);
  delete from a2_game; delete from a2_tiebreak;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, ref_seen=null, updated_at=now();
  update a2_fdev set device=null;
  update a2_team set absent=false;
  update a2_match set field_no=null, sched_at=null, sched_field=null, auto_open=false, forfeit=null, walkover=null, red_wins=0, blue_wins=0, winner_seed=null, red_seed=null, blue_seed=null, status='locked';
  update a2_event set draw_state=null, tv_mode='auto';
  perform a2_recompute();
  perform a2_audit('admin','reset',null,null,null);
end $function$;
