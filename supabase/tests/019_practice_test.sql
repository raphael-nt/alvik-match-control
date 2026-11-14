-- Rollback verification tests for migration 019_practice.sql.
-- Usage : begin; <apply 019>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare r text := ''; pw text := 'test_019_pw'; n int; k int; e text;
begin
  update a2_secret set admin_hash=a2_hash(pw) where true;
  delete from a2_game where true;
  -- T1 : create practice matches
  n := a2_adm_practice(pw, '[{"code":"P1","red":1,"blue":2,"bo":1,"at":"2026-11-20T02:00:00Z"},{"code":"P2","red":3,"blue":4,"bo":1,"at":null}]'::jsonb, false);
  select count(*) into k from a2_match where stage='practice' and status='ready';
  r := r || case when n=2 and k=2 then 'PASS ' else 'FAIL ' end || 'T1 practice created=' || n || ' ready=' || k || E'\n';
  -- T2 : a played practice game does not lock Apply format, and practice survives it
  insert into a2_game(match_code, idx, status, winner) values ('P1', 1, 'done', 'red');
  perform a2_recompute();
  perform a2_adm_format(pw, '{"teams":4}'::jsonb, '[]'::jsonb,
    '[{"code":"SF1","stage":"sf","grp":null,"order_no":1,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":4}},
      {"code":"SF2","stage":"sf","grp":null,"order_no":2,"bo":1,"red_src":{"seed":2},"blue_src":{"seed":3}},
      {"code":"F","stage":"final","grp":null,"order_no":3,"bo":1,"red_src":{"w":"SF1"},"blue_src":{"w":"SF2"}}]'::jsonb);
  select count(*) into n from a2_match where stage='practice';
  select count(*) into k from a2_game where match_code='P1';
  r := r || case when n=2 and k=1 then 'PASS ' else 'FAIL ' end || 'T2 format kept practice=' || n || ' games=' || k || E'\n';
  -- T3 : practice result does not reach the ranking
  select count(*) into n from a2_ranking();
  r := r || case when n=0 then 'PASS ' else 'FAIL ' end || 'T3 ranking rows=' || n || E'\n';
  -- T4 : replacing practice after a result needs force
  begin perform a2_adm_practice(pw, '[]'::jsonb, false); e := 'no error'; exception when others then e := sqlerrm; end;
  n := a2_adm_practice(pw, '[]'::jsonb, true);
  select count(*) into k from a2_match where stage='practice';
  r := r || case when e like 'locked%' and k=0 then 'PASS ' else 'FAIL ' end || 'T4 force clear err=' || e || ' left=' || k || E'\n';
  raise exception 'TEST REPORT%', E'\n'||r;
end $t$;
