-- 013 Explicit WHERE clauses for pg-safeupdate.
-- 012 part 2 (safeupdate.enabled = 0 per function) did not take effect on Supabase, so Call to field still failed.
-- These are the latest definitions of a2_recompute (009), a2_adm_reset (008) and a2_adm_format (009),
-- unchanged except that every whole-table UPDATE or DELETE now ends with WHERE true. Run the whole file in the SQL Editor.

-- from 009_format.sql
create or replace function public.a2_recompute()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare i int;
begin
  for i in 1..9 loop
    update a2_match set red_seed=a2_slot_seed(red_src), blue_seed=a2_slot_seed(blue_src) where true;
    update a2_match mm set walkover = case
      when mm.red_seed is null or mm.blue_seed is null then null
      else coalesce(mm.forfeit,
        case when coalesce((select absent from a2_team where seed=mm.red_seed),false) and not coalesce((select absent from a2_team where seed=mm.blue_seed),false) then 'red'
             when coalesce((select absent from a2_team where seed=mm.blue_seed),false) and not coalesce((select absent from a2_team where seed=mm.red_seed),false) then 'blue' end)
      end where true;
    update a2_match mm set
      red_wins = case mm.walkover when 'red' then 0 when 'blue' then (mm.bo+1)/2
                 else (select count(*) from a2_game g where g.match_code=mm.code and g.status='done' and g.winner='red') end,
      blue_wins = case mm.walkover when 'blue' then 0 when 'red' then (mm.bo+1)/2
                 else (select count(*) from a2_game g where g.match_code=mm.code and g.status='done' and g.winner='blue') end where true;
    update a2_match set winner_seed = case when red_wins>=(bo+1)/2 then red_seed when blue_wins>=(bo+1)/2 then blue_seed end where true;
    update a2_match mm set status = case
      when winner_seed is not null then 'done'
      when field_no is not null then (case when exists(select 1 from a2_game g where g.match_code=mm.code and g.status in ('live','review','done')) then 'live' else 'queued' end)
      when red_seed is not null and blue_seed is not null then 'ready' else 'locked' end where true;
  end loop;
  update a2_match set updated_at=now() where true;
end $function$;

-- from 008_v3_single_field.sql
create or replace function public.a2_adm_reset(p_pw text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  delete from a2_game where true; delete from a2_tiebreak where true;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, ref_seen=null, updated_at=now() where true;
  update a2_fdev set device=null where true;
  update a2_team set absent=false where true;
  update a2_match set field_no=null, sched_at=null, auto_open=false, forfeit=null, walkover=null, absent_req=null, red_wins=0, blue_wins=0, winner_seed=null, red_seed=null, blue_seed=null, status='locked' where true;
  update a2_event set draw_state=null, tv_mode='auto' where true;
  perform a2_recompute();
  perform a2_audit('admin','reset',null,null,null);
end $$;

-- from 009_format.sql
create or replace function public.a2_adm_format(p_pw text, p_format jsonb, p_groups jsonb, p_matches jsonb) returns void language plpgsql security definer set search_path=public as $$
declare n int; g jsonb; m jsonb;
begin
  perform a2_need_admin(p_pw);
  if exists(select 1 from a2_game where status<>'void') then raise exception 'locked: มีผลการแข่งแล้ว รีเซ็ตก่อนเปลี่ยนรูปแบบ'; end if;
  n := (p_format->>'teams')::int;
  if n is null or n<2 or n>64 then raise exception 'bad teams'; end if;
  if jsonb_array_length(p_groups)<1 or jsonb_array_length(p_matches)<1 then raise exception 'bad format'; end if;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, ref_seen=null, updated_at=now() where true;
  update a2_fdev set device=null where true;
  delete from a2_game where true; delete from a2_tiebreak where true; delete from a2_match where true; delete from a2_group where true;
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
  update a2_event set format=p_format, draw_state=null, tv_mode='auto', updated_at=now() where true;
  perform a2_recompute();
  perform a2_audit('admin','format.apply',null,null,p_format);
end $$;
