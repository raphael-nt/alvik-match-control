
create type public.a2_row as (slot int, seed int, mw int, ml int, gw int, gl int, pos int, sure boolean, tied boolean, how text);

create function public.a2_hash(p text) returns text language sql immutable set search_path=public,extensions as $$ select encode(extensions.digest(coalesce(p,''),'sha256'),'hex') $$;

create function public.a2_decide(g public.a2_game, out side text, out method text, out need text)
language plpgsql immutable set search_path=public as $$
declare rf boolean := g.red_parked>=3; bf boolean := g.blue_parked>=3;
begin
  if rf<>bf then side := case when rf then 'red' else 'blue' end; method:='full'; return; end if;
  if rf and bf then
    if g.red_full_ms is not null and g.blue_full_ms is not null and g.red_full_ms<>g.blue_full_ms then
      side := case when g.red_full_ms<g.blue_full_ms then 'red' else 'blue' end; method:='full'; return; end if;
  elsif g.red_parked<>g.blue_parked then
    side := case when g.red_parked>g.blue_parked then 'red' else 'blue' end; method:='count'; return;
  end if;
  if g.red_lift_ms is not null or g.blue_lift_ms is not null then
    if g.blue_lift_ms is null then side:='red'; method:='lift'; return; end if;
    if g.red_lift_ms is null then side:='blue'; method:='lift'; return; end if;
    if g.red_lift_ms<>g.blue_lift_ms then side := case when g.red_lift_ms<g.blue_lift_ms then 'red' else 'blue' end; method:='lift'; return; end if;
  end if;
  if g.red_exit_ms is not null or g.blue_exit_ms is not null then
    if g.blue_exit_ms is null then side:='red'; method:='exit'; return; end if;
    if g.red_exit_ms is null then side:='blue'; method:='exit'; return; end if;
    if g.red_exit_ms<>g.blue_exit_ms then side := case when g.red_exit_ms<g.blue_exit_ms then 'red' else 'blue' end; method:='exit'; return; end if;
    need:='replay'; return;
  end if;
  need := 'judge';
end $$;

create function public.a2_table(p_grp text) returns setof public.a2_row
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
      from (select (ord-1)::int slot, (case when e ? 'seed' then (e->>'seed')::int else a2_place(e->>'g',(e->>'p')::int) end) seed
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

create function public.a2_place(p_grp text, p int) returns int language sql stable security definer set search_path=public as $$
  select seed from a2_table(p_grp) where pos=p and sure $$;

create function public.a2_slot_seed(e jsonb) returns int language sql stable security definer set search_path=public as $$
  select case when e ? 'seed' then (e->>'seed')::int else a2_place(e->>'g',(e->>'p')::int) end $$;

create function public.a2_recompute() returns void language plpgsql security definer set search_path=public as $$
declare i int;
begin
  update a2_match mm set
    red_wins=(select count(*) from a2_game g where g.match_code=mm.code and g.status='done' and g.winner='red'),
    blue_wins=(select count(*) from a2_game g where g.match_code=mm.code and g.status='done' and g.winner='blue');
  for i in 1..4 loop
    update a2_match set red_seed=a2_slot_seed(red_src), blue_seed=a2_slot_seed(blue_src);
    update a2_match set winner_seed = case when red_wins>=(bo+1)/2 then red_seed when blue_wins>=(bo+1)/2 then blue_seed end;
    update a2_match mm set status = case
      when winner_seed is not null then 'done'
      when field_no is not null then (case when exists(select 1 from a2_game g where g.match_code=mm.code and g.status in ('live','review','done')) then 'live' else 'queued' end)
      when red_seed is not null and blue_seed is not null then 'ready' else 'locked' end;
  end loop;
  update a2_match set updated_at=now();
end $$;

create function public.a2_elapsed(f public.a2_field) returns int language plpgsql stable security definer set search_path=public as $$
declare ev a2_event; rem int;
begin
  select * into ev from a2_event;
  if f.phase<>'game' then return 0; end if;
  rem := case when f.running then greatest(0,(extract(epoch from (f.ends_at-now()))*1000)::int) else coalesce(f.left_ms,0) end;
  return greatest(0, ev.game_ms-rem);
end $$;

create function public.a2_audit(p_actor text, p_action text, p_target text, p_before jsonb, p_after jsonb) returns void language sql security definer set search_path=public as $$
  insert into a2_audit(actor,action,target,before,after) values (p_actor,p_action,p_target,p_before,p_after) $$;

create function public.a2_need_admin(p_pw text) returns void language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from a2_secret where admin_hash=a2_hash(p_pw)) then raise exception 'forbidden: admin password'; end if;
end $$;

create function public.a2_ensure_game(p_code text, p_pattern int default null) returns void language plpgsql security definer set search_path=public as $$
declare m a2_match;
begin
  select * into m from a2_match where code=p_code;
  if m.winner_seed is null and m.field_no is not null
     and not exists(select 1 from a2_game where match_code=p_code and status in ('ready','live','review')) then
    insert into a2_game(match_code,idx,pattern) values (p_code,(select coalesce(max(idx),0)+1 from a2_game where match_code=p_code),p_pattern);
  end if;
end $$;

create function public.a2_do_assign(p_code text, p_field int, p_actor text) returns void language plpgsql security definer set search_path=public as $$
declare m a2_match; f a2_field; ev a2_event;
begin
  select * into ev from a2_event;
  if p_field>ev.field_count then raise exception 'no such field'; end if;
  select * into m from a2_match where code=p_code; if not found then raise exception 'no such match'; end if;
  if m.status<>'ready' then raise exception 'match not ready: %', m.status; end if;
  select * into f from a2_field where no=p_field for update;
  if f.match_code is not null and exists(select 1 from a2_match where code=f.match_code and status<>'done') then raise exception 'field busy'; end if;
  update a2_match set field_no=null where code=f.match_code;
  update a2_field set match_code=p_code, session=gen_random_uuid(), phase='idle', running=false, ends_at=null, left_ms=null, ref_seen=null, updated_at=now() where no=p_field;
  update a2_fdev set device=null where no=p_field;
  update a2_match set field_no=p_field, updated_at=now() where code=p_code;
  perform a2_recompute();
  perform a2_ensure_game(p_code);
  perform a2_audit(p_actor,'queue.assign',p_code,null,jsonb_build_object('field',p_field));
end $$;

create function public.a2_tick() returns void language plpgsql security definer set search_path=public as $$
declare f a2_field; m record; ev a2_event;
begin
  select * into ev from a2_event;
  for f in select * from a2_field where running and ends_at<=now() loop
    if f.phase='setup' then
      update a2_field set running=false, ends_at=null, left_ms=0, updated_at=now() where no=f.no;
    elsif f.phase='game' then
      update a2_field set phase='over', running=false, ends_at=null, left_ms=0, updated_at=now() where no=f.no;
      update a2_game set status='review', version=version+1, updated_at=now() where match_code=f.match_code and status='live';
      update a2_match set updated_at=now() where code=f.match_code;
    end if;
  end loop;
  for m in
    select distinct on (sched_field) code, sched_field from a2_match
    where auto_open and sched_at<=now() and status='ready' and sched_field between 1 and ev.field_count
      and exists(select 1 from a2_field x where x.no=sched_field and (x.match_code is null or exists(select 1 from a2_match y where y.code=x.match_code and y.status='done')))
    order by sched_field, sched_at, order_no
  loop
    begin perform a2_do_assign(m.code, m.sched_field, 'system:auto'); exception when others then null; end;
  end loop;
end $$;
