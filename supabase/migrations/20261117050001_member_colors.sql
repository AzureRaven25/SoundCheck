-- Party singers joining at the same moment could read the same member count and get the same colour.
-- Lock the session row while choosing, and pick the first palette colour no active singer is using.
create or replace function public.join_session(p_code text, p_display_name text, p_platform text)
returns table (session_id uuid, member_id uuid, color text, host_platform text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_session public.karaoke_sessions;
  v_member  public.session_members;
  v_count   integer;
  v_color   text;
  palette constant text[] := array['#FF3D9A', '#38E1FF', '#FFC94D', '#3DDC97', '#8B5CFF', '#FF8A3D', '#FF5E5E', '#5E9BFF'];
begin
  if (select auth.uid()) is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  select * into v_session from public.karaoke_sessions s
   where s.pairing_code = upper(btrim(p_code)) and s.status <> 'ended' and s.expires_at > now()
   for update;
  if not found then
    raise exception 'invalid or expired code' using errcode = 'P0002';
  end if;

  select * into v_member from public.session_members m where m.session_id = v_session.id and m.user_id = (select auth.uid());
  if found then
    if v_member.kicked then
      raise exception 'removed from this session' using errcode = '42501';
    end if;
    update public.session_members m
       set left_at = null, display_name = left(coalesce(nullif(btrim(p_display_name), ''), m.display_name), 40),
           device_platform = p_platform
     where m.id = v_member.id returning * into v_member;
  else
    select count(*) into v_count from public.session_members m where m.session_id = v_session.id and not m.kicked;
    if v_count >= v_session.max_members then
      raise exception 'session is full' using errcode = '53400';
    end if;
    select c into v_color from unnest(palette) with ordinality as p(c, i)
     where c not in (select m.color from public.session_members m
                      where m.session_id = v_session.id and m.role = 'singer' and m.left_at is null and not m.kicked)
     order by i limit 1;
    insert into public.session_members (session_id, user_id, display_name, role, device_platform, color)
    values (v_session.id, (select auth.uid()), left(coalesce(nullif(btrim(p_display_name), ''), 'Singer'), 40), 'singer',
            p_platform, coalesce(v_color, palette[1 + v_count % array_length(palette, 1)]))
    returning * into v_member;
  end if;
  return query select v_session.id, v_member.id, v_member.color, v_session.host_platform;
end
$$;
