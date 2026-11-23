-- End to end rollback test : a whole Bo3 match through the referee RPCs, as the phone would call them.
-- Covers call, claim, pattern, setup start and again and skip, checklist, go, false start, marks, undo,
-- clock end, time up, mission complete, confirm, judge, replay on a tie, and the match result.
-- Usage : begin; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare r text := ''; pw text := 'e2e_pw'; pin text := '4321'; dev text := 'e2e-device-1'; ses uuid; f a2_field; g a2_game; m a2_match; res text; e text; ok boolean; n int;
  rs int; bs int;
begin
  update a2_secret set admin_hash=a2_hash(pw), ref_hash=a2_hash(pin) where true;
  update a2_event set rules_mode=true where true;
  perform a2_adm_reset_results(pw, 'all');
  select red_seed, blue_seed into rs, bs from a2_match where code='A1';

  -- T1 : admin calls A1, referee claims the field
  perform a2_adm_call(pw, 'A1');
  select * into f from a2_field where no=1; ses := f.session;
  ok := (a2_ref_claim(pin, dev)->>'control')::boolean;
  select * into g from a2_game where match_code='A1' and status='ready';
  r := r || case when f.match_code='A1' and ok and g.id is not null then 'PASS ' else 'FAIL ' end || 'T1 call and claim, game ' || coalesce(g.idx::text,'none') || E'\n';

  -- T2 : pattern, setup, again, checklist, skip to ready
  g := a2_ref_pattern(pin, dev, ses, g.id, 2);
  perform a2_ref_setup(pin, dev, ses, 'start');
  perform a2_ref_check(pin, dev, ses, 'red_in', true);
  perform a2_ref_setup(pin, dev, ses, 'again');
  select * into f from a2_field where no=1;
  r := r || case when g.pattern=2 and f.phase='setup' and f.checks='{}'::jsonb then 'PASS ' else 'FAIL ' end || 'T2 pattern and setup again clears checks, phase=' || f.phase || E'\n';
  perform a2_ref_check(pin, dev, ses, 'red_in', true); perform a2_ref_check(pin, dev, ses, 'blue_in', true); perform a2_ref_check(pin, dev, ses, 'stands', true);
  perform a2_ref_setup(pin, dev, ses, 'skip');
  select * into f from a2_field where no=1;
  r := r || case when f.phase='ready' then 'PASS ' else 'FAIL ' end || 'T3 checklist and skip, phase=' || f.phase || E'\n';

  -- T4 : go, false start back to ready, go again and the countdown ends (time moved back by hand)
  perform a2_ref_go(pin, dev, ses);
  perform a2_ref_false_start(pin, dev, ses);
  select * into f from a2_field where no=1;
  r := r || case when f.phase='ready' then 'PASS ' else 'FAIL ' end || 'T4 false start, phase=' || f.phase || E'\n';
  perform a2_ref_go(pin, dev, ses);
  update a2_field set go_at=now()-interval '20 s', ends_at=now()+interval '70 s' where no=1;
  perform a2_tick();
  select * into f from a2_field where no=1; select * into g from a2_game where id=g.id; select * into m from a2_match where code='A1';
  r := r || case when f.phase='game' and g.status='live' and m.status='live' then 'PASS ' else 'FAIL ' end || 'T5 countdown to live, game=' || g.status || E'\n';

  -- T6 : marks, undo, clock end, confirm : red parks 2, blue 1, red wins on count
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'exit_first', 'blue', 3000);
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'lift_first', 'red', 9000);
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'park', 'red', 20000);
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'park', 'red', 30000);
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'park', 'blue', 31000);
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'retry', 'blue', 32000);
  perform a2_ref_undo(pin, dev, ses, (select id from a2_mark where game_id=g.id and kind='retry' and not voided limit 1));
  perform a2_ref_clock(pin, dev, ses, 'end');
  select * into g from a2_game where id=g.id;
  r := r || case when g.status='review' and g.red_parked=2 and g.blue_parked=1 and g.blue_retries=0 then 'PASS ' else 'FAIL ' end || 'T6 marks, undo, end : parked ' || g.red_parked || '-' || g.blue_parked || ' retries blue ' || g.blue_retries || E'\n';
  res := a2_ref_confirm(pin, dev, ses, g.id);
  select * into m from a2_match where code='A1'; select * into f from a2_field where no=1;
  r := r || case when res='red' and m.red_wins=1 and m.blue_wins=0 and f.phase='idle' then 'PASS ' else 'FAIL ' end || 'T7 confirm game 1 = ' || res || ', score ' || m.red_wins || '-' || m.blue_wins || E'\n';

  -- T8 : game 2, blue mission complete stops the clock, knockout
  select * into g from a2_game where match_code='A1' and status='ready';
  g := a2_ref_pattern(pin, dev, ses, g.id, null);
  perform a2_ref_setup(pin, dev, ses, 'skip');
  perform a2_ref_check(pin, dev, ses, 'red_in', true); perform a2_ref_check(pin, dev, ses, 'blue_in', true); perform a2_ref_check(pin, dev, ses, 'stands', true);
  perform a2_ref_go(pin, dev, ses);
  update a2_field set go_at=now()-interval '50 s', ends_at=now()+interval '40 s' where no=1;
  perform a2_tick();
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'complete', 'blue', 50000);
  select * into f from a2_field where no=1;
  res := a2_ref_confirm(pin, dev, ses, g.id);
  select * into m from a2_match where code='A1';
  r := r || case when f.phase='stopped' and f.stop_ms=50000 and res='blue' and m.blue_wins=1 then 'PASS ' else 'FAIL ' end || 'T8 knockout stop at ' || f.stop_ms || ', result ' || res || ', score ' || m.red_wins || '-' || m.blue_wins || E'\n';

  -- T9 : game 3, both lift at the same time and nothing else : tie, a replay game with the same pattern
  select * into g from a2_game where match_code='A1' and status='ready';
  g := a2_ref_pattern(pin, dev, ses, g.id, 3);
  perform a2_ref_setup(pin, dev, ses, 'skip');
  perform a2_ref_check(pin, dev, ses, 'red_in', true); perform a2_ref_check(pin, dev, ses, 'blue_in', true); perform a2_ref_check(pin, dev, ses, 'stands', true);
  perform a2_ref_go(pin, dev, ses);
  update a2_field set go_at=now()-interval '10 s', ends_at=now()+interval '80 s' where no=1;
  perform a2_tick();
  perform a2_ref_mark(pin, dev, ses, g.id, gen_random_uuid(), 'lift_first', 'both', 8000);
  update a2_field set go_at=now()-interval '95 s', ends_at=now()-interval '5 s' where no=1;
  perform a2_tick();
  select * into f from a2_field where no=1;
  res := a2_ref_confirm(pin, dev, ses, g.id);
  select count(*) into n from a2_game where match_code='A1' and status='ready' and pattern=3;
  r := r || case when f.phase='over' and res='replay' and n=1 then 'PASS ' else 'FAIL ' end || 'T9 time up then tie, result ' || res || ', replay games with same pattern ' || n || E'\n';

  -- T10 : replay game, no team leaves the box : referee decides red, match ends 2-1
  select * into g from a2_game where match_code='A1' and status='ready';
  begin perform a2_ref_pattern(pin, dev, ses, g.id, 1); e := 'no error'; exception when others then e := sqlerrm; end;
  perform a2_ref_setup(pin, dev, ses, 'skip');
  perform a2_ref_check(pin, dev, ses, 'red_in', true); perform a2_ref_check(pin, dev, ses, 'blue_in', true); perform a2_ref_check(pin, dev, ses, 'stands', true);
  perform a2_ref_go(pin, dev, ses);
  update a2_field set go_at=now()-interval '95 s', ends_at=now()-interval '5 s' where no=1;
  perform a2_tick();
  res := a2_ref_confirm(pin, dev, ses, g.id);
  perform a2_ref_judge(pin, dev, ses, g.id, 'red');
  select * into m from a2_match where code='A1';
  r := r || case when e like 'locked:%' and res='judge' and m.status='done' and m.red_wins=2 and m.blue_wins=1 and m.winner_seed=rs then 'PASS ' else 'FAIL ' end
    || 'T10 replay keeps pattern (' || e || '), judge, match ' || m.status || ' ' || m.red_wins || '-' || m.blue_wins || E'\n';

  -- T11 : standings count the result, the field is free for the next call
  select count(*) into n from a2_v_standings where grp='A' and seed=rs and mw=1;
  perform a2_adm_call(pw, 'A3');
  select * into f from a2_field where no=1;
  r := r || case when n=1 and f.match_code='A3' and f.session<>ses then 'PASS ' else 'FAIL ' end || 'T11 standings has the win, next call A3 with a new session' || E'\n';

  -- T12 : an old phone with the old session is refused
  begin perform a2_ref_setup(pin, dev, ses, 'start'); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e<>'no error' then 'PASS ' else 'FAIL ' end || 'T12 old session refused : ' || e || E'\n';
  raise exception 'TEST REPORT%', E'\n'||r;
end $t$;
