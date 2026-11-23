-- Rollback verification tests for migration 022_admin_ref.sql.
-- Usage : begin; <apply 022>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare r text := ''; pw text := 't022_pw'; pin text := '4321'; f a2_field; g a2_game; m a2_match; j jsonb; e text; mid uuid; n int;
begin
  update a2_secret set admin_hash=a2_hash(pw), ref_hash=a2_hash(pin) where true;
  update a2_event set rules_mode=true where true;
  perform a2_adm_reset_results(pw, 'all');
  perform a2_adm_call(pw, 'A1');
  select * into g from a2_game where match_code='A1' and status='ready';
  -- T1 : wrong password is refused, and the admin flag does not leak to a later referee call
  begin perform a2_adm_ref('wrong', 'setup', '{"action":"start"}'); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'forbidden%' then 'PASS ' else 'FAIL ' end || 'T1 wrong password : ' || e || E'\n';
  -- T2 : pattern, setup start, checklist, setup again, skip
  j := a2_adm_ref(pw, 'pattern', jsonb_build_object('game', g.id, 'n', 2));
  perform a2_adm_ref(pw, 'setup', '{"action":"start"}');
  j := a2_adm_ref(pw, 'check', '{"item":"red_in","on":true}');
  perform a2_adm_ref(pw, 'setup', '{"action":"again"}');
  select * into f from a2_field where no=1;
  r := r || case when f.phase='setup' and f.checks='{}'::jsonb and (select pattern from a2_game where id=g.id)=2 then 'PASS ' else 'FAIL ' end || 'T2 pattern, setup, again : ' || f.phase || E'\n';
  begin perform a2_ref_setup(pin, 'phone', null, 'skip'); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'forbidden%' then 'PASS ' else 'FAIL ' end || 'T3 flag cleared, phone without session refused : ' || e || E'\n';
  -- T4 : clock pause and resume in setup, then skip, checklist, go without checklist refused
  perform a2_adm_ref(pw, 'clock', '{"action":"pause"}');
  select * into f from a2_field where no=1;
  perform a2_adm_ref(pw, 'clock', '{"action":"resume"}');
  perform a2_adm_ref(pw, 'setup', '{"action":"skip"}');
  begin perform a2_adm_ref(pw, 'go'); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when f.running = false and e like 'checklist%' then 'PASS ' else 'FAIL ' end || 'T4 pause, resume, skip, go needs checklist : ' || e || E'\n';
  perform a2_adm_ref(pw, 'check', '{"item":"red_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"blue_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"stands","on":true}');
  perform a2_adm_ref(pw, 'go');
  perform a2_adm_ref(pw, 'false_start');
  perform a2_adm_ref(pw, 'go');
  update a2_field set go_at=now()-interval '30 s', ends_at=now()+interval '60 s' where no=1;
  -- T5 : marks with undo, then end the game and confirm : red parks more
  perform a2_adm_ref(pw, 'mark', jsonb_build_object('game', g.id, 'kind', 'exit_first', 'side', 'red', 't_ms', 2000));
  perform a2_adm_ref(pw, 'mark', jsonb_build_object('game', g.id, 'kind', 'park', 'side', 'red', 't_ms', 20000));
  mid := gen_random_uuid();
  perform a2_adm_ref(pw, 'mark', jsonb_build_object('game', g.id, 'id', mid, 'kind', 'park', 'side', 'blue', 't_ms', 25000));
  j := a2_adm_ref(pw, 'undo', jsonb_build_object('id', mid));
  perform a2_adm_ref(pw, 'clock', '{"action":"end"}');
  select * into g from a2_game where id=g.id;
  r := r || case when g.status='review' and g.red_parked=1 and g.blue_parked=0 then 'PASS ' else 'FAIL ' end || 'T5 marks, undo, end : ' || g.red_parked || '-' || g.blue_parked || E'\n';
  j := a2_adm_ref(pw, 'confirm', jsonb_build_object('game', g.id));
  select * into m from a2_match where code='A1';
  select count(*) into n from a2_mark where game_id=g.id and device='ref:admin';
  r := r || case when j #>> '{}' = 'red' and m.red_wins=1 and n>=3 then 'PASS ' else 'FAIL ' end || 'T6 confirm ' || coalesce(j #>> '{}', 'null') || ', marks by ref:admin ' || n || E'\n';
  -- T7 : judge path : game 2 ends with nothing marked, admin picks blue
  select * into g from a2_game where match_code='A1' and status='ready';
  perform a2_adm_ref(pw, 'pattern', jsonb_build_object('game', g.id));
  perform a2_adm_ref(pw, 'setup', '{"action":"skip"}');
  perform a2_adm_ref(pw, 'check', '{"item":"red_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"blue_in","on":true}'); perform a2_adm_ref(pw, 'check', '{"item":"stands","on":true}');
  perform a2_adm_ref(pw, 'go');
  update a2_field set go_at=now()-interval '95 s', ends_at=now()-interval '5 s' where no=1;
  j := a2_adm_ref(pw, 'confirm', jsonb_build_object('game', g.id));
  perform a2_adm_ref(pw, 'judge', jsonb_build_object('game', g.id, 'side', 'blue'));
  select * into m from a2_match where code='A1';
  r := r || case when j #>> '{}' = 'judge' and m.red_wins=1 and m.blue_wins=1 then 'PASS ' else 'FAIL ' end || 'T7 time up, judge blue, score ' || m.red_wins || '-' || m.blue_wins || E'\n';
  -- T8 : unknown action refused
  begin perform a2_adm_ref(pw, 'nope'); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e='bad action' then 'PASS ' else 'FAIL ' end || 'T8 unknown action : ' || e || E'\n';
  raise exception 'TEST REPORT%', E'\n'||r;
end $t$;
