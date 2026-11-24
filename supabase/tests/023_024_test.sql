-- Rollback verification tests for migrations 023_ko_undo.sql and 024_custom.sql.
-- Usage : begin; <apply 023 and 024>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare r text := ''; pw text := 't023_pw'; pin text := '4321'; f a2_field; g a2_game; m a2_match; j jsonb; e text; n int; rk text; rk2 text; left_ms int;
begin
  update a2_secret set admin_hash=a2_hash(pw), ref_hash=a2_hash(pin) where true;
  update a2_event set rules_mode=true where true;
  perform a2_adm_reset_results(pw, 'all');
  perform a2_adm_clear(pw);
  select string_agg(pos||':'||coalesce(seed::text,'-'), ',' order by pos, seed) into rk from a2_ranking();

  -- T1 : Knockout, then undo : the mark is voided, the game is live again and the clock runs on from where it stopped
  perform a2_adm_call(pw, 'A1');
  select * into g from a2_game where match_code='A1' and status='ready';
  perform a2_adm_ref(pw, 'pattern', jsonb_build_object('game', g.id, 'n', 1));
  perform a2_adm_ref(pw, 'setup', '{"action":"skip"}');
  perform a2_adm_ref(pw, 'check', '{"item":"red_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"blue_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"stands","on":true}');
  perform a2_adm_ref(pw, 'go');
  update a2_field set phase='game', go_at=now()-interval '30 s', ends_at=now()+interval '60 s' where no=1;
  update a2_game set status='live' where id=g.id;
  perform a2_adm_ref(pw, 'mark', jsonb_build_object('game', g.id, 'kind', 'park', 'side', 'red', 't_ms', 20000));
  perform a2_adm_ref(pw, 'mark', jsonb_build_object('game', g.id, 'kind', 'complete', 'side', 'red', 't_ms', 30000));
  select * into f from a2_field where no=1; select * into g from a2_game where id=g.id;
  r := r || case when f.phase='stopped' and f.stop_ms=30000 and g.status='review' and g.complete_side='red' then 'PASS ' else 'FAIL ' end || 'T1a Knockout stops : ' || f.phase || ' ' || g.status || E'\n';
  j := a2_adm_ref(pw, 'ko_undo', jsonb_build_object('game', g.id));
  select * into f from a2_field where no=1; select * into g from a2_game where id=g.id;
  left_ms := (extract(epoch from (f.ends_at-now()))*1000)::int;
  r := r || case when f.phase='game' and f.running and f.stop_ms is null and g.status='live' and g.complete_side is null and g.red_parked=1
      and left_ms between 59000 and 60100 and abs(extract(epoch from (f.ends_at-f.go_at))*1000 - (select game_ms from a2_event)) < 5
      and (select voided from a2_mark where game_id=g.id and kind='complete') then 'PASS ' else 'FAIL ' end
    || 'T1b undo Knockout : ' || f.phase || ' ' || g.status || ' left ' || left_ms || ' parked ' || g.red_parked || E'\n';
  r := r || case when exists(select 1 from a2_audit where action='mark.ko_undo' and actor='ref:admin') then 'PASS ' else 'FAIL ' end || 'T1c audit row' || E'\n';

  -- T2 : a second Knockout in the same game works, and undo is refused once the result is confirmed
  perform a2_adm_ref(pw, 'mark', jsonb_build_object('game', g.id, 'kind', 'complete', 'side', 'blue', 't_ms', 40000));
  select * into g from a2_game where id=g.id;
  perform a2_adm_ref(pw, 'confirm', jsonb_build_object('game', g.id));
  begin perform a2_adm_ref(pw, 'ko_undo', jsonb_build_object('game', g.id)); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when g.complete_side='blue' and e like 'locked%' then 'PASS ' else 'FAIL ' end || 'T2 second Knockout, undo after confirm refused : ' || e || E'\n';

  -- T3 : a game ended with the clock (no Knockout) cannot use undo Knockout
  select * into g from a2_game where match_code='A1' and status='ready';
  perform a2_adm_ref(pw, 'pattern', jsonb_build_object('game', g.id, 'n', 3));
  perform a2_adm_ref(pw, 'setup', '{"action":"skip"}');
  perform a2_adm_ref(pw, 'check', '{"item":"red_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"blue_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"stands","on":true}');
  perform a2_adm_ref(pw, 'go');
  update a2_field set phase='game', go_at=now()-interval '10 s', ends_at=now()+interval '80 s' where no=1;
  update a2_game set status='live' where id=g.id;
  perform a2_adm_ref(pw, 'clock', '{"action":"pause"}'); perform a2_adm_ref(pw, 'clock', '{"action":"end"}');
  begin perform a2_adm_ref(pw, 'ko_undo', jsonb_build_object('game', g.id)); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'locked%' then 'PASS ' else 'FAIL ' end || 'T3 no Knockout to undo : ' || e || E'\n';

  -- T4 : the phone needs its session
  begin perform a2_ref_ko_undo(pin, 'phone', null, g.id); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'forbidden%' then 'PASS ' else 'FAIL ' end || 'T4 phone without session refused : ' || e || E'\n';
  perform a2_adm_clear(pw);

  -- T5 : custom match saved with names and Bo, ready to call, outside the event teams
  perform a2_adm_custom(pw, 'Alpha', 'Beta', 1, false);
  select * into m from a2_match where code='X';
  r := r || case when m.stage='custom' and m.status='ready' and m.bo=1 and m.red_seed=901 and m.blue_seed=902
      and (select name from a2_team where seed=901)='Alpha' and (select name from a2_team where seed=902)='Beta' then 'PASS ' else 'FAIL ' end
    || 'T5 custom saved : ' || coalesce(m.status,'none') || E'\n';
  begin perform a2_adm_custom('wrong', 'a', 'b', 1, false); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'forbidden%' then 'PASS ' else 'FAIL ' end || 'T5b wrong password refused : ' || e || E'\n';

  -- T6 : play it with the normal flow, a fresh start is refused while it is still playing
  perform a2_adm_call(pw, 'X');
  select * into g from a2_game where match_code='X' and status='ready';
  perform a2_adm_ref(pw, 'pattern', jsonb_build_object('game', g.id, 'n', 2));
  perform a2_adm_ref(pw, 'setup', '{"action":"skip"}');
  perform a2_adm_ref(pw, 'check', '{"item":"red_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"blue_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"stands","on":true}');
  perform a2_adm_ref(pw, 'go');
  update a2_field set phase='game', go_at=now()-interval '20 s', ends_at=now()+interval '70 s' where no=1;
  update a2_game set status='live' where id=g.id;
  begin perform a2_adm_custom(pw, 'Alpha', 'Beta', 1, true); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'locked%' then 'PASS ' else 'FAIL ' end || 'T6 fresh start refused while playing : ' || e || E'\n';
  perform a2_adm_custom(pw, 'Alpha 2', 'Beta', 3, false);
  select * into m from a2_match where code='X';
  r := r || case when m.bo=1 and (select name from a2_team where seed=901)='Alpha 2' then 'PASS ' else 'FAIL ' end || 'T6b rename while playing keeps Bo : bo ' || m.bo || E'\n';
  perform a2_adm_ref(pw, 'mark', jsonb_build_object('game', g.id, 'kind', 'complete', 'side', 'blue', 't_ms', 20000));
  perform a2_adm_ref(pw, 'confirm', jsonb_build_object('game', g.id));
  select * into m from a2_match where code='X';
  select string_agg(pos||':'||coalesce(seed::text,'-'), ',' order by pos, seed) into rk2 from a2_ranking();
  r := r || case when m.status='done' and m.winner_seed=902 and rk2 is not distinct from rk then 'PASS ' else 'FAIL ' end || 'T7 custom done, ranking unchanged : ' || m.status || E'\n';

  -- T8 : a fresh start takes the finished match off the field and clears its games
  perform a2_adm_custom(pw, 'Gamma', 'Delta', 3, true);
  select * into m from a2_match where code='X'; select * into f from a2_field where no=1;
  select count(*) into n from a2_game where match_code='X';
  r := r || case when f.match_code is null and n=0 and m.status='ready' and m.bo=3 and m.red_wins=0 and m.blue_wins=0 and m.winner_seed is null then 'PASS ' else 'FAIL ' end
    || 'T8 fresh start : field ' || coalesce(f.match_code,'empty') || ' games ' || n || ' ' || m.status || E'\n';

  -- T9 : the event teams 1 to 64 still work, seed 903 is refused
  begin insert into a2_team(seed) values (903); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like '%a2_team_seed_check%' then 'PASS ' else 'FAIL ' end || 'T9 seed check : ' || e || E'\n';

  raise exception 'TEST REPORT%', E'\n' || r;
end $t$;
