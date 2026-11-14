-- 017 Flexible tournament formats : multi-round groups, unequal group sizes and advances,
-- knockout only, 3rd place match (3P), custom matches, and dynamic ranking.
-- Updates a2_table (from 002), a2_recompute (from 013), a2_adm_format (from 013), and a2_ranking (from 009).

-- Allow group slots in any round to reference seeds, prior group places, or match winners/losers
create or replace function public.a2_table(p_grp text) returns setof public.a2_row
language plpgsql stable security definer set search_path=public as $$
declare g public.a2_group; rows public.a2_row[]; tmp public.a2_row;
  n int; i int; j int; k int; a int; b int; complete boolean; tb int[]; w int; how text; ok boolean;
begin
  select * into g from a2_group where grp=p_grp; if not found then return; end if;
  complete := not exists(select 1 from a2_match where grp=p_grp and status<>'done');
  rows := array(
    select row(x.slot,x.seed,x.mw,x.ml,x.gw,x.gl,0,false,false,'')::a2_row from (
      select s.slot, s.seed,
        coalesce(sum(case when m.winner_seed=s.seed then 1 else 0 end),0)::int mw,
        coalesce(sum(case when m.winner_seed is not null and m.winner_seed<>s.seed then 1 else 0 end),0)::int ml,
        coalesce(sum(case when m.red_seed=s.seed then m.red_wins else m.blue_wins end),0)::int gw,
        coalesce(sum(case when m.red_seed=s.seed then m.blue_wins else m.red_wins end),0)::int gl
      from (select (ord-1)::int slot, a2_slot_seed(e) seed
            from jsonb_array_elements(g.srcs) with ordinality t(e,ord)) s
      left join a2_match m on m.grp=p_grp and s.seed is not null and (m.red_seed=s.seed or m.blue_seed=s.seed)
      group by s.slot, s.seed) x
    order by x.mw desc, (x.gw-x.gl) desc, x.gw desc, x.slot);
  n := coalesce(array_length(rows,1),0);
  select seeds into tb from a2_tiebreak where grp=p_grp;
  i := 1;
  while i<=n loop
    j := i;
    while j<n and rows[j+1].mw=rows[i].mw and rows[j+1].gw-rows[j+1].gl=rows[i].gw-rows[i].gl and rows[j+1].gw=rows[i].gw loop j:=j+1; end loop;
    if j>i then
      how := '';
      if complete then
        if j-i=1 then
          select winner_seed into w from a2_match where grp=p_grp and winner_seed is not null
            and ((red_seed=rows[i].seed and blue_seed=rows[j].seed) or (red_seed=rows[j].seed and blue_seed=rows[i].seed));
          if w is not null then
            if w=rows[j].seed then tmp:=rows[i]; rows[i]:=rows[j]; rows[j]:=tmp; end if;
            how := 'h2h';
          end if;
        end if;
        if how='' and tb is not null then
          ok := true; for k in i..j loop if not (rows[k].seed = any(tb)) then ok:=false; end if; end loop;
          if ok then
            for a in i..j-1 loop for b in i..j-1 loop
              if array_position(tb,rows[b].seed)>array_position(tb,rows[b+1].seed) then tmp:=rows[b]; rows[b]:=rows[b+1]; rows[b+1]:=tmp; end if;
            end loop; end loop;
            how := 'judge';
          end if;
        end if;
      end if;
      for k in i..j loop tmp:=rows[k]; tmp.how:=how; tmp.tied:=(complete and how=''); rows[k]:=tmp; end loop;
    end if;
    i := j+1;
  end loop;
  for k in 1..n loop
    tmp := rows[k]; tmp.pos:=k;
    tmp.sure := complete and tmp.seed is not null and not tmp.tied;
    return next tmp;
  end loop;
end $$;

-- Up to 16 passes so deep multi-round brackets propagate completely
create or replace function public.a2_recompute()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare i int;
begin
  for i in 1..16 loop
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

create or replace function public.a2_adm_format(p_pw text, p_format jsonb, p_groups jsonb, p_matches jsonb) returns void language plpgsql security definer set search_path=public as $$
declare n int; g jsonb; m jsonb;
begin
  perform a2_need_admin(p_pw);
  if exists(select 1 from a2_game where status<>'void') then raise exception 'locked: มีผลการแข่งแล้ว รีเซ็ตก่อนเปลี่ยนรูปแบบ'; end if;
  n := (p_format->>'teams')::int;
  if n is null or n<2 or n>64 then raise exception 'bad teams'; end if;
  -- groups may be empty for a knockout-only format, and up to 26 (A to Z)
  if jsonb_array_length(coalesce(p_groups,'[]'::jsonb))>26 or jsonb_array_length(p_matches)<1 or jsonb_array_length(p_matches)>400 then raise exception 'bad format'; end if;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, ref_seen=null, updated_at=now() where true;
  update a2_fdev set device=null where true;
  delete from a2_game where true; delete from a2_tiebreak where true; delete from a2_match where true; delete from a2_group where true;
  delete from a2_team where seed>n;
  insert into a2_team(seed) select s from generate_series(1,n) s on conflict (seed) do nothing;
  for g in select * from jsonb_array_elements(coalesce(p_groups,'[]'::jsonb)) loop
    if (g->>'grp') !~ '^[A-Z]$' or (g->>'adv')::int < 0 then raise exception 'bad group'; end if;
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
declare
  st text; fcode text; p3code text; n int := 0; k int; maxp int; p int;
  has_next boolean; cut int; st_num int;
  seen int[] := '{}'; added int[]; grp_stages text[];
begin
  select code into fcode from a2_match where code='F' or stage='final' order by (code='F') desc, order_no desc limit 1;
  if fcode is not null then
    return query select 1, '1'::text, winner_seed from a2_match where code=fcode and winner_seed is not null;
    select array_agg(winner_seed) into added from a2_match where code=fcode and winner_seed is not null;
    if added is not null then seen := seen || array_remove(added, null); end if;

    return query select 2, '2'::text, case when winner_seed=red_seed then blue_seed else red_seed end
      from a2_match where code=fcode and winner_seed is not null and red_seed is not null and blue_seed is not null;
    select array_agg(case when winner_seed=red_seed then blue_seed else red_seed end) into added
      from a2_match where code=fcode and winner_seed is not null and red_seed is not null and blue_seed is not null;
    if added is not null then seen := seen || array_remove(added, null); end if;
    n := 2;

    select code into p3code from a2_match where code='3P' or stage='third' order by (code='3P') desc, order_no desc limit 1;
    if p3code is not null then
      return query select 3, '3'::text, winner_seed from a2_match where code=p3code and winner_seed is not null;
      return query select 4, '4'::text, case when winner_seed=red_seed then blue_seed else red_seed end
        from a2_match where code=p3code and winner_seed is not null and red_seed is not null and blue_seed is not null;
      select array_agg(sd) into added from (
        select winner_seed sd from a2_match where code=p3code and winner_seed is not null
        union all
        select case when winner_seed=red_seed then blue_seed else red_seed end from a2_match where code=p3code and winner_seed is not null and red_seed is not null and blue_seed is not null
      ) x;
      if added is not null then seen := seen || array_remove(added, null); end if;
      n := 4;
    end if;

    foreach st in array array['sf','qf','r16','r32','r64'] loop
      if st='sf' and p3code is not null then continue; end if;
      select count(*) into k from a2_match where stage=st;
      if k>0 then
        return query
          select n+1, case when k>1 then (n+1)::text||'=' else (n+1)::text end,
            case when m.winner_seed=m.red_seed then m.blue_seed else m.red_seed end
          from a2_match m
          where m.stage=st and m.winner_seed is not null and m.red_seed is not null and m.blue_seed is not null
            and not ((case when m.winner_seed=m.red_seed then m.blue_seed else m.red_seed end) = any(seen));
        select array_agg(case when m.winner_seed=m.red_seed then m.blue_seed else m.red_seed end) into added
          from a2_match m where m.stage=st and m.winner_seed is not null and m.red_seed is not null and m.blue_seed is not null;
        if added is not null then seen := seen || array_remove(added, null); end if;
        n := n+k;
      end if;
    end loop;
  end if;

  -- Group stages ordered from latest round down to r1, handling unequal group sizes and adv counts
  select array_agg(s order by case when s ~ '^r[0-9]+$' then substring(s from 2)::int else 0 end desc, s desc)
    into grp_stages from (select distinct stage as s from a2_group) gs;

  foreach st in array coalesce(grp_stages, '{}'::text[]) loop
    st_num := case when st ~ '^r[0-9]+$' then substring(st from 2)::int else 0 end;
    has_next := exists(select 1 from a2_match where grp is null)
      or exists(select 1 from a2_group where (case when stage ~ '^r[0-9]+$' then substring(stage from 2)::int else 0 end) > st_num);

    select max(jsonb_array_length(srcs) - case when has_next then adv else 0 end) into maxp from a2_group where stage=st;
    for p in 1..coalesce(maxp, 0) loop
      select count(*) into k from a2_group
        where stage=st and jsonb_array_length(srcs) >= (case when has_next then adv else 0 end) + p;
      if k > 0 then
        return query
          select n+1, case when k>1 then (n+1)::text||'=' else (n+1)::text end, t.seed
          from a2_group g
          cross join lateral a2_table(g.grp) t
          where g.stage=st
            and t.pos = (case when has_next then g.adv else 0 end) + p
            and t.sure
            and not (t.seed = any(seen));
        select array_agg(t.seed) into added
          from a2_group g
          cross join lateral a2_table(g.grp) t
          where g.stage=st
            and t.pos = (case when has_next then g.adv else 0 end) + p
            and t.sure
            and not (t.seed = any(seen));
        if added is not null then seen := seen || added; end if;
        n := n + k;
      end if;
    end loop;
  end loop;
end $$;
