-- SoundCheck M1 · 5/6 · Achievements, leaderboards, personal stats.

create table public.achievements (
  id          text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  title       text not null,
  description text not null,
  icon        text not null,                 -- symbol name; each platform maps it to its icon set
  tier        text not null default 'bronze' check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  sort_order  smallint not null default 0
);
alter table public.achievements enable row level security;
create policy "achievements are public" on public.achievements for select to anon, authenticated using (true);

insert into public.achievements (id, title, description, icon, tier, sort_order) values
  ('first_song',     'Opening Act',     'Finish your first SoundCheck Stage performance.',      'mic',        'bronze',   1),
  ('ten_songs',      'Regular',         'Finish 10 performances.',                             'repeat',     'silver',   2),
  ('fifty_songs',    'Headliner',       'Finish 50 performances.',                             'star',       'gold',     3),
  ('score_80',       'Crowd Pleaser',   'Score 80 or more.',                                   'thumbsup',   'bronze',  10),
  ('score_90',       'Showstopper',     'Score 90 or more.',                                   'flame',      'silver',  11),
  ('score_s',        'Flawless',        'Earn an S grade (95+).',                              'crown',      'gold',    12),
  ('perfect_pitch',  'Perfect Pitch',   'Reach 95% pitch accuracy on a full song.',            'tuningfork', 'gold',    20),
  ('on_the_beat',    'On the Beat',     'Reach 95% timing accuracy on a full song.',           'metronome',  'silver',  21),
  ('key_changer',    'Make It Yours',   'Finish a song in a different key.',                   'transpose',  'bronze',  30),
  ('party_starter',  'Party Starter',   'Sing in a session with 3 or more singers.',          'party',      'silver',  40);

create table public.user_achievements (
  user_id        uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null references public.achievements (id) on delete cascade,
  performance_id uuid references public.performances (id) on delete set null,
  earned_at      timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;
create policy "badges are public" on public.user_achievements for select to anon, authenticated using (true);

-- Award achievements whenever a performance is recorded.
create or replace function private.award_achievements() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
  declare
    n integer;
    singers integer;
    earned text[] := '{}';
  begin
    select count(*) into n from public.performances where user_id = new.user_id;
    earned := earned || 'first_song'::text;
    if n >= 10 then earned := earned || 'ten_songs'::text; end if;
    if n >= 50 then earned := earned || 'fifty_songs'::text; end if;
    if new.score >= 80 then earned := earned || 'score_80'::text; end if;
    if new.score >= 90 then earned := earned || 'score_90'::text; end if;
    if new.grade = 'S' then earned := earned || 'score_s'::text; end if;
    if new.pitch_score >= 0.95 then earned := earned || 'perfect_pitch'::text; end if;
    if new.timing_score >= 0.95 then earned := earned || 'on_the_beat'::text; end if;
    if new.key_shift <> 0 then earned := earned || 'key_changer'::text; end if;
    if new.session_id is not null then
      select count(*) into singers from public.session_members
       where session_id = new.session_id and role = 'singer' and not kicked;
      if singers >= 3 then earned := earned || 'party_starter'::text; end if;
    end if;
    insert into public.user_achievements (user_id, achievement_id, performance_id)
    select new.user_id, a, new.id from unnest(earned) a
    on conflict (user_id, achievement_id) do nothing;
    return new;
  end
  $$;
create trigger performances_award_achievements after insert on public.performances
  for each row execute function private.award_achievements();

-- ---------------------------------------------------------------- leaderboards
-- Best score per user for a track. scope = 'global' | 'friends' (friends include you).
create or replace function public.track_leaderboard(p_track_id uuid, p_scope text default 'global', p_limit integer default 50)
returns table (rank bigint, user_id uuid, display_name text, avatar_url text, score smallint, grade text, key_shift smallint, performed_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  with best as (
    select distinct on (pf.user_id) pf.user_id, pf.score, pf.grade, pf.key_shift, pf.created_at
    from public.performances pf
    join public.profiles pr on pr.id = pf.user_id
    where pf.track_id = p_track_id
      and pr.show_on_leaderboards and not pr.is_guest
      and (p_scope <> 'friends' or pf.user_id = (select auth.uid()) or private.are_friends(pf.user_id, (select auth.uid())))
    order by pf.user_id, pf.score desc, pf.created_at
  )
  select rank() over (order by b.score desc, b.created_at), b.user_id, p.display_name, p.avatar_url,
         b.score, b.grade, b.key_shift, b.created_at
  from best b join public.profiles p on p.id = b.user_id
  order by 1, b.created_at
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Top singers overall: average of each user's personal best per track, needing at least 3 tracks.
create or replace function public.global_leaderboard(p_scope text default 'global', p_limit integer default 50)
returns table (rank bigint, user_id uuid, display_name text, avatar_url text, avg_best real, tracks_sung bigint)
language sql stable security invoker set search_path = ''
as $$
  with best as (
    select pf.user_id, pf.track_id, max(pf.score) as best
    from public.performances pf
    join public.profiles pr on pr.id = pf.user_id
    where pr.show_on_leaderboards and not pr.is_guest
      and (p_scope <> 'friends' or pf.user_id = (select auth.uid()) or private.are_friends(pf.user_id, (select auth.uid())))
    group by pf.user_id, pf.track_id
  ), agg as (
    select user_id, avg(best)::real as avg_best, count(*) as tracks_sung from best group by user_id having count(*) >= 3
  )
  select rank() over (order by a.avg_best desc), a.user_id, p.display_name, p.avatar_url, a.avg_best, a.tracks_sung
  from agg a join public.profiles p on p.id = a.user_id
  order by 1
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create or replace function public.my_stats()
returns table (performances bigint, tracks_sung bigint, avg_score real, best_score smallint,
               avg_pitch real, avg_timing real, avg_rhythm real, avg_stability real, achievements bigint)
language sql stable security invoker set search_path = ''
as $$
  select count(*), count(distinct track_id), avg(score)::real, max(score),
         avg(pitch_score)::real, avg(timing_score)::real, avg(rhythm_score)::real, avg(stability_score)::real,
         (select count(*) from public.user_achievements ua where ua.user_id = (select auth.uid()))
  from public.performances where user_id = (select auth.uid())
$$;

grant execute on function public.track_leaderboard, public.global_leaderboard, public.my_stats to authenticated;
revoke execute on function public.track_leaderboard, public.global_leaderboard, public.my_stats from anon;
