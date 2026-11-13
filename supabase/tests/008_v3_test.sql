-- Test for migration 008. Runs in one transaction and ends with an exception so everything rolls back
-- Usage: begin; <008>; <this file>; (the report is in the error message starting with TEST REPORT)
do $t$
declare
  r text := ''; f a2_field; g a2_game; s jsonb; sess uuid; gid bigint; gid2 bigint; d record; x text; m a2_match; mk uuid; n int;
  pw text := 'testpw1'; pin text := '1234'; dv text := 'devAAAAAA';
begin
  update a2_secret set admin_hash=a2_hash(pw), ref_hash=a2_hash(pin);
  select count(*) into n from a2_field; r := r||case when n=1 then 'PASS ' else 'FAIL ' end||'field rows='||n||E'\n';

  -- ===== A. Call match, referee claim, flow, events, time up, confirm =====
  perform a2_adm_call(pw,'A1');
  select * into f from a2_field where no=1;
  r := r||case when f.match_code='A1' and f.phase='idle' then 'PASS ' else 'FAIL ' end||'call A1 phase='||f.phase||E'\n';
  s := a2_ref_claim(pin,dv); sess := (s->>'session')::uuid;
  r := r||case when (s->>'control')='true' and sess=f.session then 'PASS ' else 'FAIL ' end||'claim'||E'\n';
  s := a2_ref_claim(pin,'devBBBBBB');
  r := r||case when (s->>'control')='false' then 'PASS ' else 'FAIL ' end||'second device view only'||E'\n';
  select id into gid from a2_game where match_code='A1' and status='ready';
  begin perform a2_ref_setup(pin,dv,sess,'start'); r:=r||'FAIL setup without pattern'||E'\n'; exception when others then r:=r||'PASS setup without pattern: '||left(sqlerrm,40)||E'\n'; end;
  g := a2_ref_pattern(pin,dv,sess,gid,null);
  r := r||case when g.pattern between 1 and 3 then 'PASS ' else 'FAIL ' end||'random pattern='||g.pattern||E'\n';
  begin perform a2_ref_go(pin,dv,sess); r:=r||'FAIL go before ready'||E'\n'; exception when others then r:=r||'PASS go before ready: '||left(sqlerrm,40)||E'\n'; end;
  perform a2_ref_setup(pin,dv,sess,'start');
  select * into f from a2_field where no=1; r := r||case when f.phase='setup' and f.running then 'PASS ' else 'FAIL ' end||'setup running'||E'\n';
  begin perform a2_ref_pattern(pin,dv,sess,gid,2); r:=r||'FAIL pattern change after setup'||E'\n'; exception when others then r:=r||'PASS pattern locked after setup'||E'\n'; end;
  perform a2_ref_setup(pin,dv,sess,'skip');
  select * into f from a2_field where no=1; r := r||case when f.phase='ready' then 'PASS ' else 'FAIL ' end||'skip setup -> ready'||E'\n';
  begin perform a2_ref_go(pin,dv,sess); r:=r||'FAIL go without checklist'||E'\n'; exception when others then r:=r||'PASS go without checklist: '||left(sqlerrm,30)||E'\n'; end;
  perform a2_ref_check(pin,dv,sess,'red_in',true); perform a2_ref_check(pin,dv,sess,'blue_in',true); perform a2_ref_check(pin,dv,sess,'stands',true);
  perform a2_ref_go(pin,dv,sess);
  select * into f from a2_field where no=1; r := r||case when f.phase='countdown' and f.go_at>now() and f.ends_at>f.go_at then 'PASS ' else 'FAIL ' end||'countdown go_at set'||E'\n';
  begin perform a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'exit_first','red',100); r:=r||'FAIL mark during countdown'||E'\n'; exception when others then r:=r||'PASS mark during countdown rejected'||E'\n'; end;
  update a2_field set go_at=now()-interval '20 seconds', ends_at=now()+interval '70 seconds' where no=1;
  mk := gen_random_uuid();
  g := a2_ref_mark(pin,dv,sess,gid,mk,'exit_first','red',2400);
  r := r||case when g.status='live' and g.exit_side='red' and g.exit_ms=2400 then 'PASS ' else 'FAIL ' end||'exit_first red 2400 status='||g.status||E'\n';
  g := a2_ref_mark(pin,dv,sess,gid,mk,'exit_first','red',2400);
  select count(*) into n from a2_mark where game_id=gid and kind='exit_first'; r := r||case when n=1 then 'PASS ' else 'FAIL ' end||'idempotent resend rows='||n||E'\n';
  begin perform a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'exit_first','blue',2600); r:=r||'FAIL second exit_first'||E'\n'; exception when others then r:=r||'PASS second exit_first rejected'||E'\n'; end;
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'lift_first','blue',18000);
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'park','red',30000);
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'park','red',40000);
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'park','blue',41000);
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'retry','red',42000);
  r := r||case when g.red_parked=2 and g.blue_parked=1 and g.red_retries=1 and g.lift_side='blue' then 'PASS ' else 'FAIL ' end||'summary parked '||g.red_parked||'-'||g.blue_parked||' retries '||g.red_retries||E'\n';
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'unpark','blue',43000);
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'park','blue',44000);
  begin perform a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'unpark','red',1); perform a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'unpark','red',1); perform a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'unpark','red',1); r:=r||'FAIL unpark below 0'||E'\n'; exception when others then r:=r||'PASS unpark below 0 rejected'||E'\n'; end;
  select * into g from a2_game where id=gid; select * into d from a2_decide(g);
  r := r||case when d.side='red' and d.method='count' then 'PASS ' else 'FAIL ' end||'decide count '||coalesce(d.side,'-')||'/'||coalesce(d.method,'-')||E'\n';
  update a2_field set ends_at=now()-interval '1 second' where no=1;
  perform a2_sync();
  select * into f from a2_field where no=1; select * into g from a2_game where id=gid;
  r := r||case when f.phase='over' and g.status='review' then 'PASS ' else 'FAIL ' end||'time up -> over/review '||f.phase||'/'||g.status||E'\n';
  x := a2_ref_confirm(pin,dv,sess,gid);
  select * into m from a2_match where code='A1'; select * into f from a2_field where no=1;
  select id into gid2 from a2_game where match_code='A1' and status='ready';
  r := r||case when x='red' and m.red_wins=1 and f.phase='idle' and gid2 is not null and f.checks='{}'::jsonb then 'PASS ' else 'FAIL ' end||'confirm='||x||' wins '||m.red_wins||'-'||m.blue_wins||E'\n';

  -- ===== B. Mission complete stops clock, undo, match finishes =====
  perform a2_ref_pattern(pin,dv,sess,gid2,3);
  perform a2_ref_check(pin,dv,sess,'red_in',true); perform a2_ref_check(pin,dv,sess,'blue_in',true); perform a2_ref_check(pin,dv,sess,'stands',true);
  perform a2_ref_setup(pin,dv,sess,'skip'); perform a2_ref_go(pin,dv,sess);
  update a2_field set go_at=now()-interval '20 seconds', ends_at=now()+interval '70 seconds' where no=1;
  mk := gen_random_uuid();
  g := a2_ref_mark(pin,dv,sess,gid2,mk,'complete','red',65200);
  select * into f from a2_field where no=1;
  r := r||case when f.phase='stopped' and not f.running and f.stop_ms=65200 and g.status='review' and g.red_parked=3 and g.complete_side='red' then 'PASS ' else 'FAIL ' end||'complete stops clock phase='||f.phase||' parked='||g.red_parked||E'\n';
  g := a2_ref_undo(pin,dv,sess,mk);
  select * into f from a2_field where no=1;
  r := r||case when f.phase='game' and f.running and g.status='live' and g.complete_side is null and g.red_parked=0 then 'PASS ' else 'FAIL ' end||'undo complete resumes phase='||f.phase||E'\n';
  g := a2_ref_mark(pin,dv,sess,gid2,gen_random_uuid(),'complete','red',65200);
  x := a2_ref_confirm(pin,dv,sess,gid2);
  select * into m from a2_match where code='A1';
  r := r||case when x='red' and m.status='done' and m.winner_seed=m.red_seed then 'PASS ' else 'FAIL ' end||'match A1 done by 2-0 status='||m.status||E'\n';

  -- ===== C. Tie leads to replay, referee decides =====
  perform a2_adm_call(pw,'A2');
  select * into f from a2_field where no=1; sess := f.session;
  select id into gid from a2_game where match_code='A2' and status='ready';
  perform a2_ref_pattern(pin,dv,sess,gid,1);
  perform a2_adm_timer(pw,'setup_skip'); perform a2_adm_timer(pw,'go');
  update a2_field set go_at=now()-interval '20 seconds', ends_at=now()+interval '70 seconds' where no=1;
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'lift_first','both',5000);
  update a2_field set ends_at=now()-interval '1 second' where no=1;
  x := a2_ref_confirm(pin,dv,sess,gid);
  select * into g from a2_game where id=gid; select id into gid2 from a2_game where match_code='A2' and status='ready';
  r := r||case when x='replay' and g.status='replay' and gid2 is not null and (select pattern from a2_game where id=gid2)=1 then 'PASS ' else 'FAIL ' end||'tie -> replay same pattern '||x||E'\n';
  begin perform a2_ref_pattern(pin,dv,sess,gid2,2); r:=r||'FAIL replay pattern changed'||E'\n'; exception when others then r:=r||'PASS replay pattern locked'||E'\n'; end;
  perform a2_adm_timer(pw,'setup_skip'); perform a2_adm_timer(pw,'go');
  update a2_field set go_at=now()-interval '20 seconds', ends_at=now()-interval '1 second' where no=1;
  perform a2_sync();
  x := a2_ref_confirm(pin,dv,sess,gid2);
  select * into g from a2_game where id=gid2;
  r := r||case when x='judge' and g.status='review' and g.need='judge' then 'PASS ' else 'FAIL ' end||'no exit -> judge '||x||E'\n';
  perform a2_ref_judge(pin,dv,sess,gid2,'blue');
  select * into g from a2_game where id=gid2; select * into m from a2_match where code='A2';
  r := r||case when g.winner='blue' and g.method='judge' and g.decided_by='referee' and m.blue_wins=1 then 'PASS ' else 'FAIL ' end||'referee judge winner='||coalesce(g.winner,'-')||E'\n';

  -- ===== D. False start / call while field busy / absent request =====
  begin perform a2_adm_call(pw,'A3'); r:=r||'FAIL call while busy'||E'\n'; exception when others then r:=r||'PASS call while busy: '||left(sqlerrm,20)||E'\n'; end;
  perform a2_adm_clear(pw);
  perform a2_adm_call(pw,'A3');
  select * into f from a2_field where no=1; sess := f.session;
  select id into gid from a2_game where match_code='A3' and status='ready';
  perform a2_ref_pattern(pin,dv,sess,gid,2);
  perform a2_ref_check(pin,dv,sess,'red_in',true); perform a2_ref_check(pin,dv,sess,'blue_in',true); perform a2_ref_check(pin,dv,sess,'stands',true);
  perform a2_ref_setup(pin,dv,sess,'skip'); perform a2_ref_go(pin,dv,sess);
  update a2_field set go_at=now()-interval '5 seconds', ends_at=now()+interval '85 seconds' where no=1;
  g := a2_ref_mark(pin,dv,sess,gid,gen_random_uuid(),'exit_first','red',900);
  perform a2_ref_false_start(pin,dv,sess);
  select * into f from a2_field where no=1; select * into g from a2_game where id=gid;
  select count(*) into n from a2_mark where game_id=gid and kind='false_start';
  r := r||case when f.phase='ready' and g.status='ready' and g.exit_side is null and n=1 and not exists(select 1 from a2_mark where game_id=gid and kind<>'false_start' and not voided) and g.pattern=2 then 'PASS ' else 'FAIL ' end||'false start phase='||f.phase||E'\n';
  perform a2_ref_absent(pin,dv,sess,'red');
  select * into m from a2_match where code='A3'; r := r||case when m.absent_req='red' then 'PASS ' else 'FAIL ' end||'absent request'||E'\n';
  perform a2_adm_forfeit(pw,'A3','red');
  select * into m from a2_match where code='A3'; r := r||case when m.absent_req is null and m.forfeit='red' and m.status='done' and m.blue_wins=2 then 'PASS ' else 'FAIL ' end||'forfeit approves status='||m.status||' '||m.red_wins||'-'||m.blue_wins||E'\n';

  -- ===== E. Decision table (design 7.4) =====
  select * into g from a2_game limit 1;
  g.complete_side:=null; g.exit_side:=null; g.lift_side:=null; g.red_parked:=0; g.blue_parked:=0;
  g.complete_side:='red'; select * into d from a2_decide(g); r:=r||case when d.side='red' and d.method='full' then 'PASS ' else 'FAIL ' end||'6.1 complete red'||E'\n';
  g.complete_side:='both'; g.red_parked:=3; g.blue_parked:=3; g.lift_side:='red'; select * into d from a2_decide(g); r:=r||case when d.side='red' and d.method='lift' then 'PASS ' else 'FAIL ' end||'complete both 3-3 -> lift'||E'\n';
  g.complete_side:=null; g.red_parked:=2; g.blue_parked:=1; g.lift_side:='blue'; select * into d from a2_decide(g); r:=r||case when d.side='red' and d.method='count' then 'PASS ' else 'FAIL ' end||'6.2 count beats lift'||E'\n';
  g.red_parked:=1; select * into d from a2_decide(g); r:=r||case when d.side='blue' and d.method='lift' then 'PASS ' else 'FAIL ' end||'6.3 lift blue'||E'\n';
  g.lift_side:='both'; select * into d from a2_decide(g); r:=r||case when d.side is null and d.need='replay' then 'PASS ' else 'FAIL ' end||'lift both -> replay'||E'\n';
  g.lift_side:=null; g.exit_side:='blue'; select * into d from a2_decide(g); r:=r||case when d.side='blue' and d.method='exit' then 'PASS ' else 'FAIL ' end||'6.4 exit blue'||E'\n';
  g.lift_side:='red'; select * into d from a2_decide(g); r:=r||case when d.side='red' and d.method='lift' then 'PASS ' else 'FAIL ' end||'lift beats exit'||E'\n';
  g.lift_side:=null; g.exit_side:='both'; select * into d from a2_decide(g); r:=r||case when d.need='replay' then 'PASS ' else 'FAIL ' end||'exit both -> replay'||E'\n';
  g.exit_side:=null; select * into d from a2_decide(g); r:=r||case when d.need='judge' then 'PASS ' else 'FAIL ' end||'nobody left box -> judge'||E'\n';

  -- ===== F. Admin edits event log and result is recomputed =====
  select id into gid from a2_game where match_code='A1' and idx=1;
  select * into g from a2_game where id=gid;
  r := r||'info A1g1 winner='||g.winner||' method='||g.method||' decided_by='||g.decided_by||E'\n';
  g := a2_adm_mark(pw,gid,'add',null,'complete','blue',70000);
  r := r||case when g.winner='blue' and g.method='full' and g.blue_parked=3 then 'PASS ' else 'FAIL ' end||'admin add complete blue -> winner '||coalesce(g.winner,'-')||E'\n';
  select id into mk from a2_mark where game_id=gid and kind='complete' and not voided;
  g := a2_adm_mark(pw,gid,'void',mk);
  r := r||case when g.winner='red' and g.method='count' then 'PASS ' else 'FAIL ' end||'admin void -> back to red count'||E'\n';
  begin perform a2_adm_mark(pw,gid,'add',null,'exit_first','blue',100); perform a2_adm_mark(pw,gid,'add',null,'exit_first','red',100); r:=r||'FAIL admin duplicate'||E'\n'; exception when others then r:=r||'PASS admin duplicate exit_first rejected'||E'\n'; end;

  -- ===== G. tick calls scheduled match, privileges =====
  update a2_match set auto_open=true, sched_at=now()-interval '1 minute' where code='B1';
  perform a2_tick();
  select * into f from a2_field where no=1; r := r||case when f.match_code='B1' then 'PASS ' else 'FAIL ' end||'tick auto call -> '||coalesce(f.match_code,'-')||E'\n';
  r := r||case when not has_function_privilege('anon','a2_ref_auth(text,text,uuid)','execute') and not has_function_privilege('anon','a2_sync()','execute') and not has_function_privilege('anon','a2_flow(text,text,boolean)','execute') and not has_function_privilege('anon','a2_sum(bigint)','execute') then 'PASS ' else 'FAIL ' end||'internal functions not exposed'||E'\n';
  r := r||case when has_function_privilege('anon','a2_ref_mark(text,text,uuid,bigint,uuid,text,text,int)','execute') and has_function_privilege('anon','a2_adm_call(text,text)','execute') and has_function_privilege('anon','a2_tick()','execute') then 'PASS ' else 'FAIL ' end||'public RPC exposed'||E'\n';
  r := r||case when not has_table_privilege('anon','a2_mark','insert') and has_table_privilege('anon','a2_mark','select') then 'PASS ' else 'FAIL ' end||'a2_mark read only'||E'\n';
  raise exception E'TEST REPORT\n%', r;
end $t$;
