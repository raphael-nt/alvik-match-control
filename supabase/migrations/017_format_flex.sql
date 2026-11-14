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

-- Speed up group standings lookups and per-group recomputation
create index if not exists a2_match_grp_idx on public.a2_match(grp) where grp is not null;

-- Up to 16 passes so deep multi-round brackets propagate completely, stopping as soon as nothing changes
create or replace function public.a2_recompute()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare i int; changed int;
begin
  for i in 1..16 loop
    with
    grp_pos as materialized (
      select g.grp, t.pos, t.seed
      from a2_group g
      cross join lateral a2_table(g.grp) t
      where t.sure and t.seed is not null
    ),
    gstat as materialized (
      select match_code,
        count(*) filter (where status='done' and winner='red')::int rw,
        count(*) filter (where status='done' and winner='blue')::int bw,
        bool_or(status in ('live','review','done')) has_live
      from a2_game
      group by match_code
    ),
    step1 as (
      select mm.code, mm.bo, mm.forfeit, mm.field_no,
        case
          when mm.red_src ? 'seed' then (mm.red_src->>'seed')::int
          when mm.red_src ? 'g' then (select gp.seed from grp_pos gp where gp.grp=mm.red_src->>'g' and gp.pos=(mm.red_src->>'p')::int)
          when mm.red_src ? 'w' then (select wm.winner_seed from a2_match wm where wm.code=mm.red_src->>'w')
          when mm.red_src ? 'l' then (select case when lm.winner_seed=lm.red_seed then lm.blue_seed when lm.winner_seed=lm.blue_seed then lm.red_seed end from a2_match lm where lm.code=mm.red_src->>'l' and lm.winner_seed is not null)
        end new_red,
        case
          when mm.blue_src ? 'seed' then (mm.blue_src->>'seed')::int
          when mm.blue_src ? 'g' then (select gp.seed from grp_pos gp where gp.grp=mm.blue_src->>'g' and gp.pos=(mm.blue_src->>'p')::int)
          when mm.blue_src ? 'w' then (select wm.winner_seed from a2_match wm where wm.code=mm.blue_src->>'w')
          when mm.blue_src ? 'l' then (select case when lm.winner_seed=lm.red_seed then lm.blue_seed when lm.winner_seed=lm.blue_seed then lm.red_seed end from a2_match lm where lm.code=mm.blue_src->>'l' and lm.winner_seed is not null)
        end new_blue
      from a2_match mm
    ),
    step2 as (
      select s1.*,
        case
          when s1.new_red is null or s1.new_blue is null then null
          else coalesce(s1.forfeit,
            case when coalesce(tr.absent,false) and not coalesce(tb.absent,false) then 'red'
                 when coalesce(tb.absent,false) and not coalesce(tr.absent,false) then 'blue' end)
        end new_walkover,
        coalesce(gs.rw, 0) game_rw,
        coalesce(gs.bw, 0) game_bw,
        coalesce(gs.has_live, false) has_live
      from step1 s1
      left join a2_team tr on tr.seed=s1.new_red
      left join a2_team tb on tb.seed=s1.new_blue
      left join gstat gs on gs.match_code=s1.code
    ),
    step3 as (
      select s2.*,
        case s2.new_walkover when 'red' then 0 when 'blue' then (s2.bo+1)/2 else s2.game_rw end new_rw,
        case s2.new_walkover when 'blue' then 0 when 'red' then (s2.bo+1)/2 else s2.game_bw end new_bw
      from step2 s2
    ),
    calc as (
      select s3.code, s3.new_red, s3.new_blue, s3.new_walkover, s3.new_rw, s3.new_bw,
        case when s3.new_rw >= (s3.bo+1)/2 then s3.new_red
             when s3.new_bw >= (s3.bo+1)/2 then s3.new_blue end new_winner,
        case
          when (case when s3.new_rw >= (s3.bo+1)/2 then s3.new_red when s3.new_bw >= (s3.bo+1)/2 then s3.new_blue end) is not null then 'done'
          when s3.field_no is not null then (case when s3.has_live then 'live' else 'queued' end)
          when s3.new_red is not null and s3.new_blue is not null then 'ready'
          else 'locked'
        end new_status
      from step3 s3
    )
    update a2_match mm set
      red_seed = c.new_red,
      blue_seed = c.new_blue,
      walkover = c.new_walkover,
      red_wins = c.new_rw,
      blue_wins = c.new_bw,
      winner_seed = c.new_winner,
      status = c.new_status,
      updated_at = now()
    from calc c
    where mm.code = c.code
      and (mm.red_seed is distinct from c.new_red
        or mm.blue_seed is distinct from c.new_blue
        or mm.walkover is distinct from c.new_walkover
        or mm.red_wins is distinct from c.new_rw
        or mm.blue_wins is distinct from c.new_bw
        or mm.winner_seed is distinct from c.new_winner
        or mm.status is distinct from c.new_status);
    get diagnostics changed = row_count;
    exit when changed = 0;
  end loop;
end $function$;

create or replace function public.a2_adm_format(p_pw text, p_format jsonb, p_groups jsonb, p_matches jsonb) returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
  perform a2_need_admin(p_pw);
  if exists(select 1 from a2_game where status<>'void') then raise exception 'locked: มีผลการแข่งแล้ว รีเซ็ตก่อนเปลี่ยนรูปแบบ'; end if;
  n := (p_format->>'teams')::int;
  if n is null or n<2 or n>64 then raise exception 'bad teams'; end if;
  -- groups may be empty for a knockout-only format, and up to 26 (A to Z)
  if jsonb_array_length(coalesce(p_groups,'[]'::jsonb))>26 or jsonb_array_length(p_matches)<1 or jsonb_array_length(p_matches)>400 then raise exception 'bad format'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_groups,'[]'::jsonb)) g where coalesce(g->>'grp','') !~ '^[A-Z]$' or (g->>'adv')::int < 0) then
    raise exception 'bad group';
  end if;
  if exists(select 1 from jsonb_array_elements(p_matches) m where coalesce(m->>'code','') !~ '^[A-Z0-9-]{1,8}$' or (m->>'bo')::int not in (1,3,5,7)) then
    raise exception 'bad match';
  end if;
  update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, ref_seen=null, updated_at=now() where true;
  update a2_fdev set device=null where true;
  delete from a2_game where true; delete from a2_tiebreak where true; delete from a2_match where true; delete from a2_group where true;
  delete from a2_team where seed>n;
  insert into a2_team(seed) select s from generate_series(1,n) s on conflict (seed) do nothing;
  insert into a2_group(grp,stage,adv,srcs)
  select g->>'grp', coalesce(g->>'stage','r1'), (g->>'adv')::int, g->'srcs'
  from jsonb_array_elements(coalesce(p_groups,'[]'::jsonb)) g;
  insert into a2_match(code,stage,grp,order_no,bo,red_src,blue_src)
  select m->>'code', m->>'stage', nullif(m->>'grp',''), (m->>'order_no')::int, (m->>'bo')::int, m->'red_src', m->'blue_src'
  from jsonb_array_elements(p_matches) m;
  update a2_event set format=p_format, draw_state=null, tv_mode='auto', updated_at=now() where true;
  perform a2_recompute();
  perform a2_audit('admin','format.apply',null,null,p_format);
end $$;

create or replace function public.a2_ranking() returns table(pos int, label text, seed int) language plpgsql stable security definer set search_path=public as $$
declare
  st text; fcode text; p3code text; n int := 0; k int; stage_cnt int;
  has_next boolean; st_num int; rec record;
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

    select count(*) into stage_cnt
    from a2_group g
    cross join generate_series(1, greatest(0, jsonb_array_length(g.srcs) - case when has_next then g.adv else 0 end)) gs(p)
    where g.stage = st;

    for rec in
      with grp_info as materialized (
        select g.grp, jsonb_array_length(g.srcs) sz,
          case when has_next then g.adv else 0 end off
        from a2_group g where g.stage = st
      ),
      p_buckets as (
        select gs.p, count(*)::int k,
          coalesce(sum(count(*)) over (order by gs.p rows between unbounded preceding and 1 preceding), 0)::int prev_k
        from grp_info gi
        cross join generate_series(1, greatest(0, gi.sz - gi.off)) gs(p)
        group by gs.p
      ),
      tbl as materialized (
        select gi.grp, t.seed, (t.pos - gi.off) p
        from grp_info gi
        cross join lateral a2_table(gi.grp) t
        where t.pos > gi.off and t.sure and t.seed is not null
      )
      select (n + pb.prev_k + 1)::int r_pos,
        case when pb.k > 1 then (n + pb.prev_k + 1)::text || '=' else (n + pb.prev_k + 1)::text end r_label,
        tbl.seed r_seed
      from tbl
      join p_buckets pb on pb.p = tbl.p
      where not (tbl.seed = any(seen))
      order by pb.p, tbl.grp
    loop
      pos := rec.r_pos; label := rec.r_label; seed := rec.r_seed;
      return next;
      seen := seen || rec.r_seed;
    end loop;
    n := n + coalesce(stage_cnt, 0);
  end loop;
end $$;
