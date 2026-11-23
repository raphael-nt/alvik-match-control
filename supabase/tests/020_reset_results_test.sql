-- Rollback verification tests for migration 020_reset_results.sql.
-- Usage : begin; <apply 020>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare r text := ''; pw text := 'test_020_pw'; n int; k int; s0 int; s1 int; t0 text; t1 text; e text; st text;
begin
  update a2_secret set admin_hash=a2_hash(pw) where true;
  select count(sched_at) into s0 from a2_match;
  select string_agg(name, ',' order by seed) into t0 from a2_team;
  -- Played games on one practice and one competition match, the competition one on the field
  insert into a2_game(match_code, idx, status, winner) values ('P1', 1, 'done', 'red');
  insert into a2_game(match_code, idx, status, winner) values ('A1', 1, 'done', 'blue');
  update a2_field set match_code='A1', phase='setup' where no=1;
  perform a2_recompute();
  -- T1 : practice scope clears practice only
  n := a2_adm_reset_results(pw, 'practice');
  select count(*) into k from a2_game where match_code='P1';
  select count(*) into s1 from a2_game where match_code='A1';
  r := r || case when n=9 and k=0 and s1=1 then 'PASS ' else 'FAIL ' end || 'T1 practice reset=' || n || ' P1 games=' || k || ' A1 games=' || s1 || E'\n';
  -- T2 : competition scope clears A1 and frees the field
  n := a2_adm_reset_results(pw, 'comp');
  select count(*) into k from a2_game;
  select coalesce(match_code,'none') into st from a2_field where no=1;
  r := r || case when n=19 and k=0 and st='none' then 'PASS ' else 'FAIL ' end || 'T2 comp reset=' || n || ' games left=' || k || ' field=' || st || E'\n';
  -- T3 : schedule and team names are kept, first round matches are ready again
  select count(sched_at) into s1 from a2_match;
  select string_agg(name, ',' order by seed) into t1 from a2_team;
  select status into st from a2_match where code='A1';
  r := r || case when s1=s0 and t1=t0 and st='ready' then 'PASS ' else 'FAIL ' end || 'T3 sched kept=' || s1 || '/' || s0 || ' names kept=' || (t1=t0) || ' A1=' || st || E'\n';
  -- T4 : bad scope and bad password are refused
  begin perform a2_adm_reset_results(pw, 'x'); e := 'no error'; exception when others then e := sqlerrm; end;
  begin perform a2_adm_reset_results('wrong', 'all'); st := 'no error'; exception when others then st := sqlerrm; end;
  r := r || case when e='bad scope' and st<>'no error' then 'PASS ' else 'FAIL ' end || 'T4 scope err=' || e || ' pw err=' || st || E'\n';
  raise exception 'TEST REPORT%', E'\n'||r;
end $t$;
