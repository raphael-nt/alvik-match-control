-- 024 Custom match : one reusable match (code X, stage custom) between two names Admin types in.
-- The names live in team rows 901 (red) and 902 (blue), outside the event seeds 1 to 64, so the match runs through
-- the normal referee flow while groups, bracket and ranking never see it (no group, stage not in any round list).
-- Apply format and Reset may remove it; saving the custom match again creates it back.

alter table public.a2_team drop constraint if exists a2_team_seed_check;
alter table public.a2_team add constraint a2_team_seed_check check ((seed between 1 and 64) or seed in (901, 902));

-- Save the names and Bo. p_new starts a fresh match : results are removed, and the match is taken off the field
-- when it is there and finished. Refused while it is on the field and not finished.
create or replace function public.a2_adm_custom(p_pw text, p_red text, p_blue text, p_bo int, p_new boolean default false) returns void
language plpgsql security definer set search_path=public as $$
declare f a2_field; m a2_match; started boolean;
begin
  perform a2_need_admin(p_pw);
  if coalesce(p_bo,1) not in (1,3,5,7) then raise exception 'bad bo'; end if;
  insert into a2_team(seed,name) values (901, left(coalesce(nullif(trim(p_red),''),'Red'),40)), (902, left(coalesce(nullif(trim(p_blue),''),'Blue'),40))
    on conflict (seed) do update set name=excluded.name, updated_at=now();
  select * into f from a2_field where no=1 for update;
  select * into m from a2_match where code='X';
  if coalesce(p_new,false) and m.code is not null then
    if f.match_code='X' and m.status<>'done' then raise exception 'locked: คู่ Custom ยังแข่งอยู่บนสนาม เอาลงก่อนเริ่มคู่ใหม่'; end if;
    if f.match_code='X' then
      update a2_field set match_code=null, session=null, phase='idle', running=false, ends_at=null, left_ms=null, go_at=null, stop_ms=null, checks='{}'::jsonb, updated_at=now() where no=1;
    end if;
    delete from a2_game where match_code='X';
    update a2_match set field_no=null, forfeit=null, walkover=null, absent_req=null where code='X';
  end if;
  started := exists(select 1 from a2_game g where g.match_code='X' and g.status not in ('void','ready'));
  insert into a2_match(code,stage,grp,order_no,bo,red_src,blue_src,auto_open)
    values ('X','custom',null,0,coalesce(p_bo,1),'{"seed":901}'::jsonb,'{"seed":902}'::jsonb,false)
    on conflict (code) do update set bo = case when started then a2_match.bo else excluded.bo end, updated_at=now();
  perform a2_recompute();
  perform a2_audit('admin','custom.set','X',null,jsonb_build_object('red',p_red,'blue',p_blue,'bo',p_bo,'new',coalesce(p_new,false)));
end $$;
revoke all on function public.a2_adm_custom(text,text,text,int,boolean) from public;
grant execute on function public.a2_adm_custom(text,text,text,int,boolean) to anon, authenticated;
