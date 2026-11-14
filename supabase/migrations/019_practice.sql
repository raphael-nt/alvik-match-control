-- 019 Practice day : practice matches (stage practice, codes P1, P2 ...) that referees play with the normal pages
-- but that never count toward groups, bracket or ranking, and do not lock or get removed by Apply format.
-- Competition matches are stored with order_no + 1000 so practice matches come first in the queue.

-- Replace all practice matches. Refused while a practice game has been played unless p_force
create or replace function public.a2_adm_practice(p_pw text, p_matches jsonb, p_force boolean default false) returns int
language plpgsql security definer set search_path=public as $$
declare n int; t int := (select count(*) from a2_team);
begin
  perform a2_need_admin(p_pw);
  if not coalesce(p_force,false) and exists(select 1 from a2_game g join a2_match m on m.code=g.match_code where m.stage='practice' and g.status not in ('void','ready')) then
    raise exception 'locked: มีผลการซ้อมแล้ว ล้างการซ้อมก่อนสร้างใหม่';
  end if;
  if exists(select 1 from a2_field f join a2_match m on m.code=f.match_code where m.stage='practice' and m.status<>'done') then
    raise exception 'locked: มีคู่ซ้อมอยู่บนสนาม เอาลงก่อน';
  end if;
  if jsonb_array_length(coalesce(p_matches,'[]'::jsonb))>200 then raise exception 'bad practice'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_matches,'[]'::jsonb)) m
            where coalesce(m->>'code','') !~ '^P[0-9]{1,3}$' or (m->>'bo')::int not in (1,3,5,7)
               or (m->>'red')::int not between 1 and t or (m->>'blue')::int not between 1 and t or (m->>'red')::int=(m->>'blue')::int) then
    raise exception 'bad practice';
  end if;
  delete from a2_game g using a2_match m where m.code=g.match_code and m.stage='practice';
  delete from a2_match where stage='practice';
  insert into a2_match(code,stage,grp,order_no,bo,red_src,blue_src,sched_at,auto_open)
  select m->>'code', 'practice', null, ord::int, (m->>'bo')::int, jsonb_build_object('seed',(m->>'red')::int), jsonb_build_object('seed',(m->>'blue')::int),
         nullif(m->>'at','')::timestamptz, false
  from jsonb_array_elements(coalesce(p_matches,'[]'::jsonb)) with ordinality x(m,ord);
  get diagnostics n = row_count;
  perform a2_recompute();
  perform a2_audit('admin','practice.set',null,null,jsonb_build_object('matches',n));
  return n;
end $$;
revoke all on function public.a2_adm_practice(text,jsonb,boolean) from public;
grant execute on function public.a2_adm_practice(text,jsonb,boolean) to anon, authenticated;

create or replace function public.a2_adm_format(p_pw text, p_format jsonb, p_groups jsonb, p_matches jsonb) returns void language plpgsql security definer set search_path=public as $$
declare n int;
begin
  perform a2_need_admin(p_pw);
  if exists(select 1 from a2_game g join a2_match m on m.code=g.match_code where g.status<>'void' and m.stage<>'practice') then raise exception 'locked: มีผลการแข่งแล้ว รีเซ็ตก่อนเปลี่ยนรูปแบบ'; end if;
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
  -- practice matches (stage practice) and their games are kept
  delete from a2_game g using a2_match m where m.code=g.match_code and m.stage<>'practice';
  delete from a2_tiebreak where true; delete from a2_match where stage<>'practice'; delete from a2_group where true;
  delete from a2_match where stage='practice' and (coalesce((red_src->>'seed')::int,0)>n or coalesce((blue_src->>'seed')::int,0)>n);
  delete from a2_team where seed>n;
  insert into a2_team(seed) select s from generate_series(1,n) s on conflict (seed) do nothing;
  insert into a2_group(grp,stage,adv,srcs)
  select g->>'grp', coalesce(g->>'stage','r1'), (g->>'adv')::int, g->'srcs'
  from jsonb_array_elements(coalesce(p_groups,'[]'::jsonb)) g;
  insert into a2_match(code,stage,grp,order_no,bo,red_src,blue_src)
  select m->>'code', m->>'stage', nullif(m->>'grp',''), (m->>'order_no')::int+1000, (m->>'bo')::int, m->'red_src', m->'blue_src'
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
    has_next := exists(select 1 from a2_match where grp is null and stage<>'practice')
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
