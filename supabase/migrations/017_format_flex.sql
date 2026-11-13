-- 017 Flexible formats: knockout only (no groups) and an optional 3rd place match (code 3P, stage third).
-- a2_adm_format (latest from 013) now accepts an empty group list. a2_ranking (from 009) ranks 3P for places 3 and 4.
-- Run the whole file in the Supabase SQL Editor.

create or replace function public.a2_adm_format(p_pw text, p_format jsonb, p_groups jsonb, p_matches jsonb) returns void language plpgsql security definer set search_path=public as $$
declare n int; g jsonb; m jsonb;
begin
  perform a2_need_admin(p_pw);
  if exists(select 1 from a2_game where status<>'void') then raise exception 'locked: มีผลการแข่งแล้ว รีเซ็ตก่อนเปลี่ยนรูปแบบ'; end if;
  n := (p_format->>'teams')::int;
  if n is null or n<2 or n>64 then raise exception 'bad teams'; end if;
  -- groups may be empty for a knockout-only format
  if jsonb_array_length(coalesce(p_groups,'[]'::jsonb))>26 or jsonb_array_length(p_matches)<1 then raise exception 'bad format'; end if;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, ref_seen=null, updated_at=now() where true;
  update a2_fdev set device=null where true;
  delete from a2_game where true; delete from a2_tiebreak where true; delete from a2_match where true; delete from a2_group where true;
  delete from a2_team where seed>n;
  insert into a2_team(seed) select s from generate_series(1,n) s on conflict (seed) do nothing;
  for g in select * from jsonb_array_elements(coalesce(p_groups,'[]'::jsonb)) loop
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

create or replace function public.a2_ranking() returns table(pos int, label text, seed int) language plpgsql stable security definer set search_path=public as $$
declare st text; n int := 0; k int; maxp int; p int;
begin
  if exists(select 1 from a2_match where code='F') then
    return query select 1, '1'::text, winner_seed from a2_match where code='F';
    return query select 2, '2'::text, case when winner_seed=red_seed then blue_seed else red_seed end from a2_match where code='F' and winner_seed is not null;
    n := 2;
    -- 3rd place match decides places 3 and 4, so semifinal losers are not listed again
    if exists(select 1 from a2_match where code='3P') then
      return query select 3, '3'::text, winner_seed from a2_match where code='3P' and winner_seed is not null;
      return query select 4, '4'::text, case when winner_seed=red_seed then blue_seed else red_seed end from a2_match where code='3P' and winner_seed is not null;
      n := 4;
    end if;
    foreach st in array array['sf','qf','r16','r32','r64'] loop
      if st='sf' and exists(select 1 from a2_match where code='3P') then continue; end if;
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
