-- Host controls: remove a singer from the party (they can't rejoin with the same account; join_session refuses
-- kicked members).
create or replace function public.remove_session_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare s uuid;
begin
  select m.session_id into s from public.session_members m where m.id = p_member_id;
  if s is null then raise exception 'singer not found' using errcode = 'PT404'; end if;
  if not exists (select 1 from public.karaoke_sessions k where k.id = s and k.host_id = (select auth.uid())) then
    raise exception 'only the host can remove singers' using errcode = '42501';
  end if;
  update public.session_members set kicked = true, left_at = now() where id = p_member_id;
end;
$$;
revoke execute on function public.remove_session_member(uuid) from public, anon;
grant execute on function public.remove_session_member(uuid) to authenticated;
