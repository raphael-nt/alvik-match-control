-- 018 On-site tools : change Bo during the event, postpone a match to the end of the queue,
-- an announcement shown on the Dashboard (a2_event.notice, a2_event.notice_on),
-- and a2_recompute (from 017) so a team marked absent no longer turns matches it already played into forfeits.

alter table public.a2_event add column if not exists notice text;
alter table public.a2_event add column if not exists notice_on boolean not null default false;

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
            -- a withdrawn team only loses matches that have not started, results already played stay
            case when coalesce(gs.rw,0)+coalesce(gs.bw,0)>0 or coalesce(gs.has_live,false) then null
                 when coalesce(tr.absent,false) and not coalesce(tb.absent,false) then 'red'
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

-- Change Bo of matches that have not started a game yet. p_codes null = every such match
create or replace function public.a2_adm_bo(p_pw text, p_codes text[], p_bo int) returns int
language plpgsql security definer set search_path=public as $$
declare n int;
begin
  perform a2_need_admin(p_pw);
  if p_bo not in (1,3,5,7) then raise exception 'bad bo'; end if;
  update a2_match m set bo=p_bo, updated_at=now()
  where (p_codes is null or m.code = any(p_codes))
    and m.status<>'done' and m.forfeit is null
    and not exists(select 1 from a2_game g where g.match_code=m.code and g.status<>'void' and g.status<>'ready');
  get diagnostics n = row_count;
  perform a2_recompute();
  perform a2_audit('admin','match.bo',array_to_string(p_codes,','),null,jsonb_build_object('bo',p_bo,'changed',n));
  return n;
end $$;

-- Move a waiting match to the end of the queue (its scheduled time and auto call are cleared)
create or replace function public.a2_adm_postpone(p_pw text, p_code text) returns void
language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  if not exists(select 1 from a2_match where code=p_code and status in ('locked','ready') and field_no is null) then
    raise exception 'locked: เลื่อนได้เฉพาะคู่ที่ยังไม่ขึ้นสนาม';
  end if;
  update a2_match set order_no=(select max(order_no)+1 from a2_match), sched_at=null, auto_open=false, updated_at=now() where code=p_code;
  perform a2_audit('admin','match.postpone',p_code,null,null);
end $$;

-- a2_adm_event (latest from 014) plus notice and notice_on
create or replace function public.a2_adm_event(p_pw text, p jsonb) returns void language plpgsql security definer set search_path=public as $$
begin
  perform a2_need_admin(p_pw);
  if p ? 'dash_layout' and pg_column_size(p->'dash_layout') > 8000 then raise exception 'bad layout'; end if;
  update a2_event set
    name=coalesce(p->>'name',name), setup_ms=coalesce((p->>'setup_ms')::int,setup_ms), game_ms=coalesce((p->>'game_ms')::int,game_ms),
    countdown_ms=coalesce((p->>'countdown_ms')::int,countdown_ms), tv_mode=coalesce(p->>'tv_mode',tv_mode),
    rules_mode=coalesce((p->>'rules_mode')::boolean,rules_mode),
    docs_ref=coalesce((p->>'docs_ref')::boolean,docs_ref),
    notice=case when p ? 'notice' then left(nullif(p->>'notice',''),200) else notice end,
    notice_on=coalesce((p->>'notice_on')::boolean,notice_on),
    dash_layout=case when p ? 'dash_layout' then nullif(p->'dash_layout','null'::jsonb) else dash_layout end,
    tv_focus=case when p ? 'tv_focus' then nullif(p->>'tv_focus','')::int else tv_focus end,
    draw_state=case when p ? 'draw_state' then p->'draw_state' else draw_state end, updated_at=now()
  where id=1;
  if p ? 'new_pw' then update a2_secret set admin_hash=a2_hash(p->>'new_pw') where true; end if;
  if p ? 'new_pin' then update a2_secret set ref_hash=a2_hash(p->>'new_pin') where true; end if;
  perform a2_audit('admin','event.update',null,null,p - 'new_pw' - 'new_pin');
end $$;

revoke all on function public.a2_adm_bo(text,text[],int), public.a2_adm_postpone(text,text), public.a2_adm_event(text,jsonb) from public;
grant execute on function public.a2_adm_bo(text,text[],int), public.a2_adm_postpone(text,text), public.a2_adm_event(text,jsonb) to anon, authenticated;
