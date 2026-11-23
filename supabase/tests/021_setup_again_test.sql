-- Rollback verification tests for migration 021_setup_again.sql.
-- Usage : begin; <apply 021>; <this file>; rollback; (report is raised as exception starting with TEST REPORT)
do $t$
declare r text := ''; f a2_field; sm int; e text; left_s numeric;
begin
  select setup_ms into sm from a2_event;
  delete from a2_game where match_code='A1';
  insert into a2_game(match_code, idx, status, pattern) values ('A1', 1, 'ready', 2);
  update a2_field set match_code='A1', phase='ready', running=false, ends_at=null, go_at=null,
    checks='{"red_in":true,"blue_in":true,"stands":true}'::jsonb where no=1;
  -- T1 : from Ready, Setup again restarts the full setup time and clears the checklist
  perform a2_flow('setup_again', 'test');
  select * into f from a2_field where no=1;
  left_s := extract(epoch from f.ends_at - now());
  r := r || case when f.phase='setup' and f.running and f.checks='{}'::jsonb and abs(left_s*1000 - sm) < 2000 then 'PASS ' else 'FAIL ' end
    || 'T1 phase=' || f.phase || ' running=' || f.running || ' checks=' || f.checks || ' left_s=' || round(left_s,1) || E'\n';
  -- T2 : from a paused Setup it also restarts
  update a2_field set running=false, left_ms=12000, ends_at=null where no=1;
  perform a2_flow('setup_again', 'test');
  select * into f from a2_field where no=1;
  r := r || case when f.phase='setup' and f.running and f.left_ms is null and f.ends_at is not null then 'PASS ' else 'FAIL ' end
    || 'T2 paused restart running=' || f.running || ' left_ms=' || coalesce(f.left_ms::text,'null') || E'\n';
  -- T3 : refused while idle and during the countdown
  update a2_field set phase='idle' where no=1;
  begin perform a2_flow('setup_again', 'test'); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'locked:%' then 'PASS ' else 'FAIL ' end || 'T3 idle err=' || e || E'\n';
  update a2_field set phase='countdown', go_at=now()+interval '3 s' where no=1;
  begin perform a2_flow('setup_again', 'test'); e := 'no error'; exception when others then e := sqlerrm; end;
  r := r || case when e like 'locked:%' then 'PASS ' else 'FAIL ' end || 'T4 countdown err=' || e || E'\n';
  -- T5 : the old actions still work, setup_start from idle
  update a2_field set phase='idle', go_at=null where no=1;
  perform a2_flow('setup_start', 'test');
  select * into f from a2_field where no=1;
  r := r || case when f.phase='setup' then 'PASS ' else 'FAIL ' end || 'T5 setup_start phase=' || f.phase || E'\n';
  -- T6 : the referee RPC accepts again
  r := r || case when pg_get_functiondef('public.a2_ref_setup(text,text,uuid,text)'::regprocedure) like '%''again''%' then 'PASS ' else 'FAIL ' end || 'T6 a2_ref_setup accepts again' || E'\n';
  raise exception 'TEST REPORT%', E'\n'||r;
end $t$;
