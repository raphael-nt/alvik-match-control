-- 020 Reset results only : clear games and match results but keep team names, the format, the schedule
-- (sched_at, auto_open) and the practice matches, so a test run can be wiped without setting times again.
-- p_scope : 'all', 'practice' (practice matches only) or 'comp' (competition matches only).
-- Returns the number of matches that were reset.
create or replace function public.a2_adm_reset_results(p_pw text, p_scope text default 'all') returns int
language plpgsql security definer set search_path=public as $$
declare codes text[]; n int;
begin
  perform a2_need_admin(p_pw);
  if coalesce(p_scope,'') not in ('all','practice','comp') then raise exception 'bad scope'; end if;
  select coalesce(array_agg(code),'{}') into codes from a2_match
   where p_scope='all' or (p_scope='practice') = (stage='practice');
  delete from a2_game where match_code = any(codes);
  -- Take a reset match off the field and free the referee phone
  if exists(select 1 from a2_field where match_code = any(codes)) then
    update a2_fdev set device=null where no in (select no from a2_field where match_code = any(codes));
    update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null,
      checks='{}'::jsonb, ref_seen=null, updated_at=now() where match_code = any(codes);
  end if;
  -- Tie breaks and absent flags belong to the competition, practice never uses them
  if p_scope <> 'practice' then
    delete from a2_tiebreak where true;
    update a2_team set absent=false where true;
  end if;
  update a2_match set field_no=null, forfeit=null, walkover=null, absent_req=null, red_wins=0, blue_wins=0, winner_seed=null,
    red_seed=null, blue_seed=null, status='locked', updated_at=now() where code = any(codes);
  get diagnostics n = row_count;
  perform a2_recompute();
  perform a2_audit('admin','reset.results',null,null,jsonb_build_object('scope',p_scope,'matches',n));
  return n;
end $$;

revoke all on function public.a2_adm_reset_results(text,text) from public;
grant execute on function public.a2_adm_reset_results(text,text) to anon, authenticated;
