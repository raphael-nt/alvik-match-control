-- Rollback verification tests for migration 018_onsite.sql.
-- Usage : begin; <apply 018>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare r text := ''; pw text := 'test_018_pw'; n int; s1 int; s2 int; w text; win int; o1 int; o2 int;
begin
  update a2_secret set admin_hash=a2_hash(pw) where true;
  delete from a2_game where true;
  perform a2_recompute();

  -- T1 : change Bo of every match that has not started
  n := a2_adm_bo(pw, null, 1);
  select count(*) into s1 from a2_match where bo<>1 and status<>'done';
  r := r || case when n>0 and s1=0 then 'PASS ' else 'FAIL ' end || 'T1 bo all changed=' || n || ' left=' || s1 || E'\n';

  -- T2 : postpone moves the match to the end and clears its time
  select order_no into o1 from a2_match where code='A1';
  perform a2_adm_postpone(pw, 'A1');
  select order_no into o2 from a2_match where code='A1';
  r := r || case when o2=(select max(order_no) from a2_match) and o2>o1 then 'PASS ' else 'FAIL ' end || 'T2 postpone ' || o1 || '>' || o2 || E'\n';

  -- T3 : notice on and off through a2_adm_event
  perform a2_adm_event(pw, '{"notice":"test notice","notice_on":true}'::jsonb);
  select count(*) into n from a2_event where notice='test notice' and notice_on;
  perform a2_adm_event(pw, '{"notice_on":false}'::jsonb);
  select count(*) into s1 from a2_event where notice='test notice' and not notice_on;
  r := r || case when n=1 and s1=1 then 'PASS ' else 'FAIL ' end || 'T3 notice' || E'\n';

  -- T4 : a withdrawn team keeps a match it already won, and forfeits the ones not started
  select red_seed into s1 from a2_match where code='A1';
  insert into a2_game(match_code, idx, status, winner) values ('A1', 1, 'done', 'red');
  perform a2_recompute();
  perform a2_adm_absent(pw, s1, true);
  select walkover, winner_seed into w, win from a2_match where code='A1';
  select count(*) into n from a2_match where (red_seed=s1 or blue_seed=s1) and code<>'A1' and walkover is not null;
  select count(*) into s2 from a2_match where (red_seed=s1 or blue_seed=s1) and code<>'A1';
  r := r || case when w is null and win=s1 and n=s2 and s2>0 then 'PASS ' else 'FAIL ' end || 'T4 absent keeps played A1 walkover=' || coalesce(w,'null') || ' winner=' || coalesce(win::text,'null') || ' others ' || n || '/' || s2 || E'\n';

  -- T5 : a started match cannot change Bo
  n := a2_adm_bo(pw, array['A1'], 5);
  r := r || case when n=0 then 'PASS ' else 'FAIL ' end || 'T5 bo locked after start changed=' || n || E'\n';

  raise exception 'TEST REPORT%', E'\n'||r;
end $t$;
