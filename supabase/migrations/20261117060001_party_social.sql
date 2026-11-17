-- SoundCheck M8 · Party queues, friends, achievements, and TV sign-in with a phone.

-- ---------------------------------------------------------------- party queue
-- Anyone in the session adds songs; positions are appended atomically (the session row is locked).
create or replace function public.enqueue_song(p_session_id uuid, p_track_id uuid, p_singer_member_ids uuid[] default '{}')
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_pos double precision;
  v_id uuid;
begin
  if not (private.is_session_member(p_session_id) or private.is_session_host(p_session_id)) then
    raise exception 'not in this session' using errcode = '42501';
  end if;
  perform 1 from public.karaoke_sessions where id = p_session_id for update;
  select coalesce(max(position), 0) + 1 into v_pos from public.session_queue where session_id = p_session_id;
  insert into public.session_queue (session_id, track_id, singer_member_ids, position)
  values (p_session_id, p_track_id, coalesce(p_singer_member_ids, '{}'), v_pos)
  returning id into v_id;
  return v_id;
end
$$;

-- The queue with song and requester names (visible to the session's host and members only, via RLS).
create or replace function public.session_queue_list(p_session_id uuid)
returns table (id uuid, track_id uuid, title text, artist_credit text, requested_by uuid, requester_name text,
               singer_member_ids uuid[], key_shift smallint, status text, queue_position double precision)
language sql stable security invoker set search_path = ''
as $$
  select q.id, q.track_id, t.title, t.artist_credit, q.requested_by, coalesce(m.display_name, p.display_name),
         q.singer_member_ids, q.key_shift, q.status, q.position
  from public.session_queue q
  join public.tracks t on t.id = q.track_id
  left join public.session_members m on m.session_id = q.session_id and m.user_id = q.requested_by
  left join public.profiles p on p.id = q.requested_by
  where q.session_id = p_session_id and q.status in ('queued', 'playing')
  order by (q.status = 'playing') desc, q.position
$$;

-- Host only: finish the current song and start the next one. Returns the queue item now playing (or none).
create or replace function public.advance_queue(p_session_id uuid, p_skip boolean default false)
returns table (id uuid, track_id uuid)
language plpgsql security invoker set search_path = ''
as $$
begin
  if not private.is_session_host(p_session_id) then
    raise exception 'only the host can advance the queue' using errcode = '42501';
  end if;
  update public.session_queue q set status = case when p_skip then 'skipped' else 'done' end
   where q.session_id = p_session_id and q.status = 'playing';
  return query
  update public.session_queue q set status = 'playing'
   where q.id = (select q2.id from public.session_queue q2 where q2.session_id = p_session_id and q2.status = 'queued'
                  order by q2.position limit 1)
  returning q.id, q.track_id;
end
$$;

grant execute on function public.enqueue_song, public.session_queue_list, public.advance_queue to authenticated;
revoke execute on function public.enqueue_song, public.session_queue_list, public.advance_queue from anon;

-- ---------------------------------------------------------------- friends
-- Find people to add: signed-up singers (not guests) by name or username, excluding you.
create or replace function public.search_people(p_query text, p_limit integer default 20)
returns table (id uuid, display_name text, username text, avatar_url text, relationship text)
language sql stable security invoker set search_path = ''
as $$
  select p.id, p.display_name, p.username, p.avatar_url,
         case
           when f.status = 'accepted' then 'friends'
           when f.user_id = (select auth.uid()) then 'requested'
           when f.friend_id = (select auth.uid()) then 'incoming'
           else 'none'
         end
  from public.profiles p
  left join public.friendships f
    on (f.user_id = (select auth.uid()) and f.friend_id = p.id) or (f.friend_id = (select auth.uid()) and f.user_id = p.id)
  where p.id <> (select auth.uid()) and not p.is_guest
    and length(btrim(coalesce(p_query, ''))) >= 2
    and (p.display_name ilike '%' || btrim(p_query) || '%' or p.username ilike btrim(p_query) || '%')
  order by (p.username = lower(btrim(p_query))) desc, p.display_name
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- Your friends and pending requests, with names and each friend's best recent score.
create or replace function public.my_friends()
returns table (id uuid, display_name text, username text, avatar_url text, status text, direction text,
               since timestamptz, songs_sung bigint, best_score smallint)
language sql stable security invoker set search_path = ''
as $$
  select p.id, p.display_name, p.username, p.avatar_url, f.status,
         case when f.user_id = (select auth.uid()) then 'outgoing' else 'incoming' end,
         coalesce(f.accepted_at, f.created_at),
         (select count(*) from public.performances pf where pf.user_id = p.id and f.status = 'accepted'),
         (select max(pf.score) from public.performances pf where pf.user_id = p.id and f.status = 'accepted')
  from public.friendships f
  join public.profiles p on p.id = case when f.user_id = (select auth.uid()) then f.friend_id else f.user_id end
  where (select auth.uid()) in (f.user_id, f.friend_id)
  order by f.status = 'pending' desc, p.display_name
$$;

-- Scores are private to you and the session you sang in; let friends see each other's recent performances too.
create policy "friends see each other's performances" on public.performances for select to authenticated
  using (private.are_friends(user_id, (select auth.uid())));

-- Accepting must also stamp accepted_at.
create or replace function private.friendship_accepted() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if new.status = 'accepted' and old.status <> 'accepted' then new.accepted_at := now(); end if;
    return new;
  end
  $$;
create trigger friendships_accepted before update on public.friendships
  for each row execute function private.friendship_accepted();

-- ---------------------------------------------------------------- achievements
-- Every achievement with your progress (earned_at is null until earned).
create or replace function public.my_achievements()
returns table (id text, title text, description text, icon text, tier text, earned_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select a.id, a.title, a.description, a.icon, a.tier, ua.earned_at
  from public.achievements a
  left join public.user_achievements ua on ua.achievement_id = a.id and ua.user_id = (select auth.uid())
  order by ua.earned_at is null, a.sort_order
$$;

insert into public.achievements (id, title, description, icon, tier, sort_order) values
  ('first_friend',  'Duet Partner',   'Make your first SoundCheck friend.',             'people',  'bronze', 41),
  ('encore',        'Encore',         'Sing the same song 3 times.',                    'repeat',  'bronze', 31),
  ('night_owl',     'Night Owl',      'Finish a song between midnight and 4 a.m.',      'moon',    'bronze', 32)
on conflict (id) do nothing;

-- Extend the award trigger with the new performance-based badges.
create or replace function private.award_achievements_m8() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if (select count(*) from public.performances where user_id = new.user_id and track_id = new.track_id) >= 3 then
      insert into public.user_achievements (user_id, achievement_id, performance_id) values (new.user_id, 'encore', new.id)
      on conflict do nothing;
    end if;
    if extract(hour from new.created_at at time zone 'UTC') between 0 and 3 then
      -- UTC approximation; the apps show the badge, the exact local hour isn't security relevant
      insert into public.user_achievements (user_id, achievement_id, performance_id) values (new.user_id, 'night_owl', new.id)
      on conflict do nothing;
    end if;
    return new;
  end
  $$;
create trigger performances_award_achievements_m8 after insert on public.performances
  for each row execute function private.award_achievements_m8();

create or replace function private.award_first_friend() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  begin
    if new.status = 'accepted' then
      insert into public.user_achievements (user_id, achievement_id) values (new.user_id, 'first_friend'), (new.friend_id, 'first_friend')
      on conflict do nothing;
    end if;
    return new;
  end
  $$;
create trigger friendships_award after update on public.friendships
  for each row execute function private.award_first_friend();

grant execute on function public.search_people, public.my_friends, public.my_achievements to authenticated;
revoke execute on function public.search_people, public.my_friends, public.my_achievements from anon;

-- ---------------------------------------------------------------- TV sign-in with a phone (device flow)
-- The TV gets a short user code to show and a long secret device code to poll with. A signed-in phone approves
-- the user code; the device-auth Edge Function (service role) then hands the TV a one-time sign-in token.
create table private.device_codes (
  device_code  text primary key,                     -- sha256 hex of the secret the TV holds
  user_code    text not null,
  platform     text not null,
  approved_by  uuid references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '10 minutes'
);
create unique index device_codes_user_code_idx on private.device_codes (user_code);
revoke all on private.device_codes from anon, authenticated;
