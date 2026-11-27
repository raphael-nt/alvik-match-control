-- Rollback verification tests for migration 026_game_flip.sql.
-- Usage : begin; <apply 026>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
-- Works on the Custom match X only, so tournament matches, standings and ranking are not touched.
do $t$
declare r text := ''; pw text := 't026_pw'; g a2_game; m a2_match; e text; rk text; rk2 text; fld text; gid bigint; v int;
begin
  update a2_secret set admin_hash=a2_hash(pw) where true;
  select string_agg(pos||':'||coalesce(seed::text,'-'), ',' order by pos, seed) into rk from a2_ranking();
  select match_code into fld from a2_field where no=1;

  -- A finished game 1 of the Custom match : red parks twice and completes first, blue parks once and retries once
  perform a2_adm_custom(pw, 'Alpha', 'Beta', 3, true);
  insert into a2_game(match_code, idx) values ('X', 1) returning id into gid;
  insert into a2_mark(game_id, kind, side, t_ms, source) values
    (gid, 'park', 'red', 10000, 'admin'), (gid, 'park', 'red', 15000, 'admin'), (gid, 'complete', 'red', 30000, 'admin'),
    (gid, 'park', 'blue', 12000, 'admin'), (gid, 'retry', 'blue', 14000, 'admin'), (gid, 'exit_first', 'both', 2000, 'admin');
  perform a2_sum(gid);
  update a2_game set status='done', winner='red', method='complete', decided_by='ref' where id=gid;
  perform a2_recompute();
  select * into m from a2_match where code='X';
  r := r || case when m.red_wins=1 and m.blue_wins=0 then 'PASS ' else 'FAIL ' end || 'T0 setup : X ' || m.red_wins || '-' || m.blue_wins || E'\n';

  -- T1 : flip moves every mark and the win to the other team and marks the game as played on the other colours
  g := a2_adm_game_flip(pw, gid);
  select * into m from a2_match where code='X';
  r := r || case when g.side_fix and g.winner='blue' and g.method='complete' and g.complete_side='blue' and g.blue_parked=3 and g.red_parked=1
      and g.red_retries=1 and g.blue_retries=0 and g.exit_side='both' and m.red_wins=0 and m.blue_wins=1 then 'PASS ' else 'FAIL ' end
    || 'T1 flip : winner ' || g.winner || ' parked ' || g.red_parked || '/' || g.blue_parked || ' retries ' || g.red_retries || '/' || g.blue_retries
    || ' X ' || m.red_wins || '-' || m.blue_wins || E'\n';
  r := r || case when (select count(*) from a2_mark where game_id=gid and side='blue' and kind='park')=2
      and (select count(*) from a2_mark where game_id=gid and side='both')=1 then 'PASS ' else 'FAIL ' end || 'T1b marks moved, both stays both' || E'\n';
  r := r || case when exists(select 1 from a2_audit where action='game.flip' and target='X/g1') then 'PASS ' else 'FAIL ' end || 'T1c audit row' || E'\n';

  -- T2 : a second flip puts everything back
  g := a2_adm_game_flip(pw, gid);
  select * into m from a2_match where code='X';
  r := r || case when not g.side_fix and g.winner='red' and g.complete_side='red' and g.red_parked=3 and g.blue_parked=1 and m.red_wins=1 and m.blue_wins=0
    then 'PASS ' else 'FAIL ' end || 'T2 flip back : winner ' || g.winner || ' X ' || m.red_wins || '-' || m.blue_wins || E'\n';

  -- T3 : a stale version is refused
  v := g.version - 1;
  begin perform a2_adm_game_flip(pw, gid, v); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'stale%' then 'PASS ' else 'FAIL ' end || 'T3 stale version : ' || e || E'\n';

  -- T4 : a wrong password is refused
  begin perform a2_adm_game_flip('wrong', gid); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e <> 'no error' then 'PASS ' else 'FAIL ' end || 'T4 wrong password : ' || e || E'\n';

  -- T5 : a voided game is refused
  update a2_game set status='void' where id=gid;
  begin perform a2_adm_game_flip(pw, gid); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'locked%' then 'PASS ' else 'FAIL ' end || 'T5 void game : ' || e || E'\n';

  -- T6 : tournament ranking and the match on the field are untouched
  select string_agg(pos||':'||coalesce(seed::text,'-'), ',' order by pos, seed) into rk2 from a2_ranking();
  r := r || case when rk2 is not distinct from rk and (select match_code from a2_field where no=1) is not distinct from fld then 'PASS ' else 'FAIL ' end
    || 'T6 ranking and field unchanged : field ' || coalesce(fld, 'empty') || E'\n';

  raise exception 'TEST REPORT%', E'\n' || r;
end $t$;
