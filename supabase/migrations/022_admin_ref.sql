-- 022 Admin as referee : the admin, signed in with the admin password, runs the same referee actions as the
-- phone (pattern, setup, checklist, go, false start, marks, undo, clock, confirm, judge) from the Admin page.
-- a2_adm_ref checks the password, then marks this transaction as admin so a2_ref_auth skips the PIN, device
-- and session checks. Everything else is the referee code itself, so both paths follow the same rules.
-- The audit and the marks show the actor as ref:admin.

create or replace function public.a2_ref_auth(p_pin text, p_device text, p_session uuid) returns a2_field
language plpgsql security definer set search_path=public as $$
declare f a2_field; dv text;
begin
  -- Set only by a2_adm_ref after the admin password was checked, and only for this transaction
  if coalesce(current_setting('a2.admin', true), '') = '1' then
    perform a2_sync();
    select * into f from a2_field where no=1 for update;
    if f.match_code is null then raise exception 'locked: ยังไม่มีคู่บนสนาม'; end if;
    return f;
  end if;
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  perform a2_sync();
  select * into f from a2_field where no=1 for update;
  select device into dv from a2_fdev where no=1;
  if f.match_code is null or f.session is distinct from p_session or dv is distinct from p_device then raise exception 'forbidden: session'; end if;
  return f;
end $$;

create or replace function public.a2_adm_ref(p_pw text, p_fn text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r jsonb; d constant text := 'admin';
begin
  perform a2_need_admin(p_pw);
  perform set_config('a2.admin', '1', true);
  p := coalesce(p, '{}'::jsonb);
  case p_fn
    when 'pattern' then r := to_jsonb(a2_ref_pattern(null, d, null, (p->>'game')::bigint, (p->>'n')::int));
    when 'setup' then perform a2_ref_setup(null, d, null, p->>'action');
    when 'check' then r := a2_ref_check(null, d, null, p->>'item', (p->>'on')::boolean);
    when 'go' then perform a2_ref_go(null, d, null);
    when 'false_start' then perform a2_ref_false_start(null, d, null);
    when 'mark' then r := to_jsonb(a2_ref_mark(null, d, null, (p->>'game')::bigint, coalesce((p->>'id')::uuid, gen_random_uuid()), p->>'kind', p->>'side', (p->>'t_ms')::int));
    when 'undo' then r := to_jsonb(a2_ref_undo(null, d, null, (p->>'id')::uuid));
    when 'clock' then perform a2_ref_clock(null, d, null, p->>'action');
    when 'confirm' then r := to_jsonb(a2_ref_confirm(null, d, null, (p->>'game')::bigint));
    when 'judge' then perform a2_ref_judge(null, d, null, (p->>'game')::bigint, p->>'side');
    else raise exception 'bad action';
  end case;
  perform set_config('a2.admin', '', true);
  return r;
end $$;

grant execute on function public.a2_adm_ref(text, text, jsonb) to anon, authenticated;
