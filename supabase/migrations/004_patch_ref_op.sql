-- Run after 003: allow a2_ref_op edits while the game is in review
do $$ declare d text; begin
  d := pg_get_functiondef('public.a2_ref_op(text,text,int,uuid,bigint,text,text,int)'::regprocedure);
  d := replace(d, 'if g.status<>''live'' then raise exception ''locked: เกมไม่ได้กำลังแข่ง''', 'if g.status not in (''live'',''review'') then raise exception ''locked: เกมไม่ได้กำลังแข่ง''');
  d := replace(d, 'if g.red_parked>=3 and g.blue_parked>=3 then', 'if g.status=''live'' and g.red_parked>=3 and g.blue_parked>=3 then');
  execute d;
  d := pg_get_functiondef('public.a2_elapsed(public.a2_field)'::regprocedure);
  d := replace(d, 'if f.phase<>''game'' then return 0; end if;', 'if f.phase=''over'' then return ev.game_ms; end if; if f.phase<>''game'' then return 0; end if;');
  execute d;
  revoke all on function public.a2_elapsed(public.a2_field) from public, anon, authenticated;
  revoke all on function public.a2_ref_op(text,text,int,uuid,bigint,text,text,int) from public, anon;
  grant execute on function public.a2_ref_op(text,text,int,uuid,bigint,text,text,int) to anon, authenticated;
end $$;
select proname, has_function_privilege('anon', p.oid, 'execute') anon_exec, prosrc like '%not in (''live'',''review'')%' patched from pg_proc p where proname in ('a2_ref_op','a2_elapsed','a2_decide','a2_tick','a2_table');