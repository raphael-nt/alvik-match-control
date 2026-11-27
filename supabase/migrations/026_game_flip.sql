-- 026 : fix the colours of one game when the two teams played it on each other's colour.
-- Sides swap every game by game number (see gameSwapped in shared/common.js). When the teams stand on the wrong
-- colours, everything the referee pressed by colour lands on the wrong team. a2_adm_game_flip moves every mark of
-- that game to the other side, flips the winner, rebuilds the game summary from the marks and recomputes the match.
-- It also toggles side_fix, which the pages read so the game shows, and takes new presses, with the colours the
-- teams really played. Pressing it again puts everything back.

alter table public.a2_game add column if not exists side_fix boolean not null default false;

create or replace function public.a2_adm_game_flip(p_pw text, p_game bigint, p_version integer default null) returns a2_game
language plpgsql security definer set search_path=public as $$
declare g a2_game; before jsonb;
begin
  perform a2_need_admin(p_pw);
  select * into g from a2_game where id=p_game for update;
  if g.id is null then raise exception 'no game'; end if;
  if g.status='void' then raise exception 'locked: เกมนี้ถูกลบแล้ว'; end if;
  if p_version is not null and p_version<>g.version then raise exception 'stale: ข้อมูลเปลี่ยนไปแล้ว'; end if;
  before := to_jsonb(g);
  update a2_mark set side = case side when 'red' then 'blue' when 'blue' then 'red' else side end where game_id=p_game;
  update a2_game set side_fix = not side_fix,
    winner = case winner when 'red' then 'blue' when 'blue' then 'red' else winner end
  where id=p_game;
  perform a2_sum(p_game);
  perform a2_recompute();
  perform a2_ensure_game(g.match_code);
  select * into g from a2_game where id=p_game;
  perform a2_audit('admin','game.flip',g.match_code||'/g'||g.idx,before,to_jsonb(g));
  return g;
end $$;
revoke all on function public.a2_adm_game_flip(text,bigint,integer) from public;
grant execute on function public.a2_adm_game_flip(text,bigint,integer) to anon, authenticated;
