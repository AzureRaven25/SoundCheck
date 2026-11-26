-- Friend invite links and "what your friends sang".

-- The person behind an invite link (/friends?invite=<id>): name and avatar only, never guests.
create or replace function public.invite_profile(p_user_id uuid)
returns table (id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.avatar_url from public.profiles p where p.id = p_user_id and not p.is_guest
$$;
grant execute on function public.invite_profile(uuid) to anon, authenticated;

-- Your friends' latest scored songs (accepted friends only).
create or replace function public.friends_activity(p_limit integer default 20)
returns table (user_id uuid, display_name text, avatar_url text, track_id uuid, title text, artist_credit text,
               score smallint, grade text, performed_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select pf.user_id, pr.display_name, pr.avatar_url, pf.track_id, t.title, t.artist_credit, pf.score, pf.grade, pf.created_at
    from public.performances pf
    join public.profiles pr on pr.id = pf.user_id
    join public.tracks t on t.id = pf.track_id
   where (select auth.uid()) is not null and private.are_friends(pf.user_id, (select auth.uid()))
   order by pf.created_at desc
   limit least(greatest(p_limit, 1), 50)
$$;
revoke execute on function public.friends_activity(integer) from public, anon;
grant execute on function public.friends_activity(integer) to authenticated;
