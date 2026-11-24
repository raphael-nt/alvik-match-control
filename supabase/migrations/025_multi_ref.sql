-- 025 Several referee devices : any device with the referee PIN can run the match on the field at the same time,
-- so a referee can switch phones without Transfer referee. The session check stays, so a call left over from the
-- previous match is still refused. a2_fdev keeps the last device seen, for the online line in Admin only.

create or replace function public.a2_ref_auth(p_pin text, p_device text, p_session uuid) returns a2_field
language plpgsql security definer set search_path=public as $$
declare f a2_field;
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
  if f.match_code is null or f.session is distinct from p_session then raise exception 'forbidden: session'; end if;
  return f;
end $$;

create or replace function public.a2_ref_claim(p_pin text, p_device text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare f a2_field;
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  select * into f from a2_field where no=1;
  update a2_fdev set device=p_device where no=1;
  update a2_field set ref_seen=now() where no=1;
  return jsonb_build_object('control',true,'session',f.session);
end $$;

create or replace function public.a2_ref_heartbeat(p_pin text, p_device text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  if not a2_ref_login(p_pin) then raise exception 'forbidden: pin'; end if;
  update a2_fdev set device=p_device where no=1;
  update a2_field set ref_seen=now() where no=1;
  return true;
end $$;
