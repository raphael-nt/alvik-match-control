-- Rollback verification tests for migration 017_format_flex.sql.
-- Usage : begin; <apply 017>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare
  r text := '';
  pw text := 'test_017_pw';
  rk text;
  n int;
begin
  update a2_secret set admin_hash=a2_hash(pw);
  delete from a2_game where true;

  -- Test 1 : Multi-round groups (A, B, C to D, E to F) and ranking without duplicate seeds
  perform a2_adm_format(pw,
    '{"teams":9}'::jsonb,
    '[
      {"grp":"A","stage":"r1","adv":2,"srcs":[{"seed":1},{"seed":2},{"seed":3}]},
      {"grp":"B","stage":"r1","adv":2,"srcs":[{"seed":4},{"seed":5},{"seed":6}]},
      {"grp":"C","stage":"r1","adv":2,"srcs":[{"seed":7},{"seed":8},{"seed":9}]},
      {"grp":"D","stage":"r2","adv":1,"srcs":[{"g":"A","p":1},{"g":"C","p":1},{"g":"B","p":2}]},
      {"grp":"E","stage":"r2","adv":1,"srcs":[{"g":"B","p":1},{"g":"A","p":2},{"g":"C","p":2}]}
    ]'::jsonb,
    '[
      {"code":"A1","stage":"r1","grp":"A","order_no":1,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":2}},
      {"code":"A2","stage":"r1","grp":"A","order_no":2,"bo":1,"red_src":{"seed":2},"blue_src":{"seed":3}},
      {"code":"A3","stage":"r1","grp":"A","order_no":3,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":3}},
      {"code":"B1","stage":"r1","grp":"B","order_no":4,"bo":1,"red_src":{"seed":4},"blue_src":{"seed":5}},
      {"code":"B2","stage":"r1","grp":"B","order_no":5,"bo":1,"red_src":{"seed":5},"blue_src":{"seed":6}},
      {"code":"B3","stage":"r1","grp":"B","order_no":6,"bo":1,"red_src":{"seed":4},"blue_src":{"seed":6}},
      {"code":"C1","stage":"r1","grp":"C","order_no":7,"bo":1,"red_src":{"seed":7},"blue_src":{"seed":8}},
      {"code":"C2","stage":"r1","grp":"C","order_no":8,"bo":1,"red_src":{"seed":8},"blue_src":{"seed":9}},
      {"code":"C3","stage":"r1","grp":"C","order_no":9,"bo":1,"red_src":{"seed":7},"blue_src":{"seed":9}},
      {"code":"D1","stage":"r2","grp":"D","order_no":10,"bo":1,"red_src":{"g":"A","p":1},"blue_src":{"g":"C","p":1}},
      {"code":"D2","stage":"r2","grp":"D","order_no":11,"bo":1,"red_src":{"g":"C","p":1},"blue_src":{"g":"B","p":2}},
      {"code":"D3","stage":"r2","grp":"D","order_no":12,"bo":1,"red_src":{"g":"A","p":1},"blue_src":{"g":"B","p":2}},
      {"code":"E1","stage":"r2","grp":"E","order_no":13,"bo":1,"red_src":{"g":"B","p":1},"blue_src":{"g":"A","p":2}},
      {"code":"E2","stage":"r2","grp":"E","order_no":14,"bo":1,"red_src":{"g":"A","p":2},"blue_src":{"g":"C","p":2}},
      {"code":"E3","stage":"r2","grp":"E","order_no":15,"bo":1,"red_src":{"g":"B","p":1},"blue_src":{"g":"C","p":2}},
      {"code":"F","stage":"final","grp":null,"order_no":16,"bo":1,"red_src":{"g":"D","p":1},"blue_src":{"g":"E","p":1}}
    ]'::jsonb);
  update a2_match set forfeit='blue' where true;
  perform a2_recompute();
  select string_agg(label||':'||seed::text, ',' order by pos, seed) into rk from a2_ranking();
  select count(distinct seed) into n from a2_ranking();
  r := r || case when n=9 and rk='1:1,2:4,3=:5,3=:7,5=:2,5=:8,7=:3,7=:6,7=:9' then 'PASS ' else 'FAIL ' end || 'T1 9-team multi-round rk=' || coalesce(rk,'null') || ' uniq=' || n || E'\n';

  -- Test 2 : Unequal group sizes and advances A(4, adv 2), B(3, adv 1) to D(3, adv 2) to F
  perform a2_adm_format(pw,
    '{"teams":7}'::jsonb,
    '[
      {"grp":"A","stage":"r1","adv":2,"srcs":[{"seed":1},{"seed":2},{"seed":3},{"seed":4}]},
      {"grp":"B","stage":"r1","adv":1,"srcs":[{"seed":5},{"seed":6},{"seed":7}]},
      {"grp":"D","stage":"r2","adv":2,"srcs":[{"g":"A","p":1},{"g":"B","p":1},{"g":"A","p":2}]}
    ]'::jsonb,
    '[
      {"code":"A1","stage":"r1","grp":"A","order_no":1,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":2}},
      {"code":"A2","stage":"r1","grp":"A","order_no":2,"bo":1,"red_src":{"seed":3},"blue_src":{"seed":4}},
      {"code":"A3","stage":"r1","grp":"A","order_no":3,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":3}},
      {"code":"A4","stage":"r1","grp":"A","order_no":4,"bo":1,"red_src":{"seed":2},"blue_src":{"seed":4}},
      {"code":"A5","stage":"r1","grp":"A","order_no":5,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":4}},
      {"code":"A6","stage":"r1","grp":"A","order_no":6,"bo":1,"red_src":{"seed":2},"blue_src":{"seed":3}},
      {"code":"B1","stage":"r1","grp":"B","order_no":7,"bo":1,"red_src":{"seed":5},"blue_src":{"seed":6}},
      {"code":"B2","stage":"r1","grp":"B","order_no":8,"bo":1,"red_src":{"seed":6},"blue_src":{"seed":7}},
      {"code":"B3","stage":"r1","grp":"B","order_no":9,"bo":1,"red_src":{"seed":5},"blue_src":{"seed":7}},
      {"code":"D1","stage":"r2","grp":"D","order_no":10,"bo":1,"red_src":{"g":"A","p":1},"blue_src":{"g":"B","p":1}},
      {"code":"D2","stage":"r2","grp":"D","order_no":11,"bo":1,"red_src":{"g":"B","p":1},"blue_src":{"g":"A","p":2}},
      {"code":"D3","stage":"r2","grp":"D","order_no":12,"bo":1,"red_src":{"g":"A","p":1},"blue_src":{"g":"A","p":2}},
      {"code":"F","stage":"final","grp":null,"order_no":13,"bo":1,"red_src":{"g":"D","p":1},"blue_src":{"g":"D","p":2}}
    ]'::jsonb);
  update a2_match set forfeit='blue' where true;
  perform a2_recompute();
  select string_agg(label||':'||seed::text, ',' order by pos, seed) into rk from a2_ranking();
  select count(distinct seed) into n from a2_ranking();
  r := r || case when n=7 and rk='1:1,2:5,3:2,4=:3,4=:6,6=:4,6=:7' then 'PASS ' else 'FAIL ' end || 'T2 unequal rk=' || coalesce(rk,'null') || ' uniq=' || n || E'\n';

  -- Test 3 : Knockout only with 8 teams and 3rd place match (3P)
  perform a2_adm_format(pw,
    '{"teams":8}'::jsonb,
    '[]'::jsonb,
    '[
      {"code":"QF1","stage":"qf","grp":null,"order_no":1,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":8}},
      {"code":"QF2","stage":"qf","grp":null,"order_no":2,"bo":1,"red_src":{"seed":4},"blue_src":{"seed":5}},
      {"code":"QF3","stage":"qf","grp":null,"order_no":3,"bo":1,"red_src":{"seed":2},"blue_src":{"seed":7}},
      {"code":"QF4","stage":"qf","grp":null,"order_no":4,"bo":1,"red_src":{"seed":3},"blue_src":{"seed":6}},
      {"code":"SF1","stage":"sf","grp":null,"order_no":5,"bo":1,"red_src":{"w":"QF1"},"blue_src":{"w":"QF2"}},
      {"code":"SF2","stage":"sf","grp":null,"order_no":6,"bo":1,"red_src":{"w":"QF3"},"blue_src":{"w":"QF4"}},
      {"code":"3P","stage":"third","grp":null,"order_no":7,"bo":1,"red_src":{"l":"SF1"},"blue_src":{"l":"SF2"}},
      {"code":"F","stage":"final","grp":null,"order_no":8,"bo":1,"red_src":{"w":"SF1"},"blue_src":{"w":"SF2"}}
    ]'::jsonb);
  update a2_match set forfeit='blue' where true;
  perform a2_recompute();
  select string_agg(label||':'||seed::text, ',' order by pos, seed) into rk from a2_ranking();
  select count(distinct seed) into n from a2_ranking();
  r := r || case when n=8 and rk='1:1,2:2,3:4,4:3,5=:5,5=:6,5=:7,5=:8' then 'PASS ' else 'FAIL ' end || 'T3 KO-only+3P rk=' || coalesce(rk,'null') || ' uniq=' || n || E'\n';

  -- Test 4 : Groups only with adv=0
  perform a2_adm_format(pw,
    '{"teams":6}'::jsonb,
    '[
      {"grp":"A","stage":"r1","adv":0,"srcs":[{"seed":1},{"seed":2},{"seed":3}]},
      {"grp":"B","stage":"r1","adv":0,"srcs":[{"seed":4},{"seed":5},{"seed":6}]}
    ]'::jsonb,
    '[
      {"code":"A1","stage":"r1","grp":"A","order_no":1,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":2}},
      {"code":"A2","stage":"r1","grp":"A","order_no":2,"bo":1,"red_src":{"seed":2},"blue_src":{"seed":3}},
      {"code":"A3","stage":"r1","grp":"A","order_no":3,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":3}},
      {"code":"B1","stage":"r1","grp":"B","order_no":4,"bo":1,"red_src":{"seed":4},"blue_src":{"seed":5}},
      {"code":"B2","stage":"r1","grp":"B","order_no":5,"bo":1,"red_src":{"seed":5},"blue_src":{"seed":6}},
      {"code":"B3","stage":"r1","grp":"B","order_no":6,"bo":1,"red_src":{"seed":4},"blue_src":{"seed":6}}
    ]'::jsonb);
  update a2_match set forfeit='blue' where true;
  perform a2_recompute();
  select string_agg(label||':'||seed::text, ',' order by pos, seed) into rk from a2_ranking();
  select count(distinct seed) into n from a2_ranking();
  r := r || case when n=6 and rk='1=:1,1=:4,3=:2,3=:5,5=:3,5=:6' then 'PASS ' else 'FAIL ' end || 'T4 Groups-only rk=' || coalesce(rk,'null') || ' uniq=' || n || E'\n';

  -- Test 5 : Custom group accepting winner/loser sources and 12-pass deep recompute
  perform a2_adm_format(pw,
    '{"teams":4}'::jsonb,
    '[{"grp":"A","stage":"r2","adv":0,"srcs":[{"w":"M1"},{"l":"M2"}]}]'::jsonb,
    '[
      {"code":"M1","stage":"r1","grp":null,"order_no":1,"bo":1,"red_src":{"seed":1},"blue_src":{"seed":2}},
      {"code":"M2","stage":"r1","grp":null,"order_no":2,"bo":1,"red_src":{"seed":3},"blue_src":{"seed":4}},
      {"code":"A1","stage":"r2","grp":"A","order_no":3,"bo":1,"red_src":{"w":"M1"},"blue_src":{"l":"M2"}},
      {"code":"C1","stage":"qf","grp":null,"order_no":4,"bo":1,"red_src":{"g":"A","p":1},"blue_src":{"seed":2}},
      {"code":"C2","stage":"qf","grp":null,"order_no":5,"bo":1,"red_src":{"w":"C1"},"blue_src":{"seed":3}},
      {"code":"C3","stage":"qf","grp":null,"order_no":6,"bo":1,"red_src":{"w":"C2"},"blue_src":{"seed":3}},
      {"code":"C4","stage":"qf","grp":null,"order_no":7,"bo":1,"red_src":{"w":"C3"},"blue_src":{"seed":3}},
      {"code":"C5","stage":"qf","grp":null,"order_no":8,"bo":1,"red_src":{"w":"C4"},"blue_src":{"seed":3}},
      {"code":"C6","stage":"qf","grp":null,"order_no":9,"bo":1,"red_src":{"w":"C5"},"blue_src":{"seed":3}},
      {"code":"C7","stage":"qf","grp":null,"order_no":10,"bo":1,"red_src":{"w":"C6"},"blue_src":{"seed":3}},
      {"code":"C8","stage":"qf","grp":null,"order_no":11,"bo":1,"red_src":{"w":"C7"},"blue_src":{"seed":3}},
      {"code":"C9","stage":"qf","grp":null,"order_no":12,"bo":1,"red_src":{"w":"C8"},"blue_src":{"seed":3}},
      {"code":"F","stage":"final","grp":null,"order_no":13,"bo":1,"red_src":{"w":"C9"},"blue_src":{"g":"A","p":2}}
    ]'::jsonb);
  update a2_match set forfeit='blue' where true;
  perform a2_recompute();
  select winner_seed into n from a2_match where code='F';
  r := r || case when n=1 then 'PASS ' else 'FAIL ' end || 'T5 custom+deep F winner=' || coalesce(n::text,'null') || E'\n';

  raise exception 'TEST REPORT%', E'\n'||r;
end $t$;
