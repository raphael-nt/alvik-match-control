-- 009 adjustable format: number of groups, teams per group, knockout after groups.
-- The page builds groups and matches (shared/format.js) and a2_adm_format replaces them.

alter table public.a2_event add column if not exists format jsonb;
alter table public.a2_team drop constraint if exists a2_team_seed_check;
alter table public.a2_team add constraint a2_team_seed_check check (seed between 1 and 64);
alter publication supabase_realtime add table public.a2_group;

-- Slot sources: {seed}, {g,p} place p of group g, {w} winner of match, {l} loser of match
create or replace function public.a2_slot_seed(e jsonb) returns int language sql stable security definer set search_path=public as $$
  select case
    when e ? 'seed' then (e->>'seed')::int
    when e ? 'g' then a2_place(e->>'g',(e->>'p')::int)
    when e ? 'w' then (select winner_seed from a2_match where code=e->>'w')
    when e ? 'l' then (select case when winner_seed=red_seed then blue_seed when winner_seed=blue_seed then red_seed end from a2_match where code=e->>'l' and winner_seed is not null)
  end $$;

-- More passes so winners can travel through up to 6 knockout rounds
create or replace function public.a2_recompute()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare i int;
begin
  for i in 1..9 loop
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

-- Final ranking: final winner and loser, then knockout losers by round, then group places outside the knockout
create or replace function public.a2_ranking() returns table(pos int, label text, seed int) language plpgsql stable security definer set search_path=public as $$
declare st text; n int := 0; k int; maxp int; p int;
begin
  if exists(select 1 from a2_match where code='F') then
    return query select 1, '1'::text, winner_seed from a2_match where code='F';
    return query select 2, '2'::text, case when winner_seed=red_seed then blue_seed else red_seed end from a2_match where code='F' and winner_seed is not null;
    n := 2;
    foreach st in array array['sf','qf','r16','r32','r64'] loop
      select count(*) into k from a2_match where stage=st;
      if k>0 then
        return query select n+1, (n+1)::text||'=', case when m.winner_seed=m.red_seed then m.blue_seed else m.red_seed end from a2_match m where m.stage=st and m.winner_seed is not null;
        n := n+k;
      end if;
    end loop;
    -- byes: teams that skipped a round count with the round they reached, so n is the number of knockout teams
    select count(distinct s) into n from (select red_src s from a2_match where stage in ('final','sf','qf','r16','r32','r64') and red_src ? 'g' union all select blue_src from a2_match where stage in ('final','sf','qf','r16','r32','r64') and blue_src ? 'g') x;
  end if;
  foreach st in array array['r2','r1'] loop
    select max(jsonb_array_length(srcs)) into maxp from a2_group where stage=st;
    for p in 1..coalesce(maxp,0) loop
      if exists(select 1 from a2_group where stage=st and adv>=p) and (exists(select 1 from a2_match where code='F') or (st='r1' and exists(select 1 from a2_group where stage='r2'))) then continue; end if;
      select count(*) into k from a2_group where stage=st and jsonb_array_length(srcs)>=p;
      return query select n+1, case when k>1 then (n+1)::text||'=' else (n+1)::text end, t.seed from a2_group g cross join lateral a2_table(g.grp) t where g.stage=st and t.pos=p and t.sure;
      n := n+k;
    end loop;
  end loop;
end $$;

drop view if exists public.a2_v_standings;
drop view if exists public.a2_v_ranking;
create view public.a2_v_standings as select g.grp, t.* from public.a2_group g cross join lateral public.a2_table(g.grp) t;
create view public.a2_v_ranking as select * from public.a2_ranking();
grant select on public.a2_v_standings, public.a2_v_ranking to anon, authenticated;

-- Replace the format. Allowed only before any game is played (reset first)
create or replace function public.a2_adm_format(p_pw text, p_format jsonb, p_groups jsonb, p_matches jsonb) returns void language plpgsql security definer set search_path=public as $$
declare n int; g jsonb; m jsonb;
begin
  perform a2_need_admin(p_pw);
  if exists(select 1 from a2_game where status<>'void') then raise exception 'locked: มีผลการแข่งแล้ว รีเซ็ตก่อนเปลี่ยนรูปแบบ'; end if;
  n := (p_format->>'teams')::int;
  if n is null or n<2 or n>64 then raise exception 'bad teams'; end if;
  if jsonb_array_length(p_groups)<1 or jsonb_array_length(p_matches)<1 then raise exception 'bad format'; end if;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, ref_seen=null, updated_at=now();
  update a2_fdev set device=null;
  delete from a2_game; delete from a2_tiebreak; delete from a2_match; delete from a2_group;
  delete from a2_team where seed>n;
  insert into a2_team(seed) select s from generate_series(1,n) s on conflict (seed) do nothing;
  for g in select * from jsonb_array_elements(p_groups) loop
    if (g->>'grp') !~ '^[A-Z]$' then raise exception 'bad group'; end if;
    insert into a2_group(grp,stage,adv,srcs) values (g->>'grp', coalesce(g->>'stage','r1'), (g->>'adv')::int, g->'srcs');
  end loop;
  for m in select * from jsonb_array_elements(p_matches) loop
    if (m->>'code') !~ '^[A-Z0-9-]{1,8}$' or (m->>'bo')::int not in (1,3,5,7) then raise exception 'bad match'; end if;
    insert into a2_match(code,stage,grp,order_no,bo,red_src,blue_src) values (m->>'code', m->>'stage', nullif(m->>'grp',''), (m->>'order_no')::int, (m->>'bo')::int, m->'red_src', m->'blue_src');
  end loop;
  update a2_event set format=p_format, draw_state=null, tv_mode='auto', updated_at=now();
  perform a2_recompute();
  perform a2_audit('admin','format.apply',null,null,p_format);
end $$;

-- Team names for any team count
create or replace function public.a2_adm_teams(p_pw text, p_names text[]) returns void language plpgsql security definer set search_path=public as $$
declare i int;
begin
  perform a2_need_admin(p_pw);
  for i in 1..coalesce(array_length(p_names,1),0) loop update a2_team set name=left(coalesce(p_names[i],''),40), updated_at=now() where seed=i; end loop;
  perform a2_audit('admin','teams.set',null,null,to_jsonb(p_names));
end $$;

-- Current 9 team layout as the stored default
update public.a2_event set format='{"groups":3,"size":3,"advance":2,"bo_group":3,"bo_ko":3,"bo_final":5,"teams":9,"legacy":true}'::jsonb where format is null;

do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'a2\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and ((p.proname like 'a2\_adm\_%' or p.proname like 'a2\_ref\_%') and p.proname<>'a2_ref_auth'
      or p.proname in ('a2_setup','a2_has_setup','a2_admin_login','a2_now','a2_tick','a2_table','a2_place','a2_slot_seed','a2_ranking')) loop
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;
