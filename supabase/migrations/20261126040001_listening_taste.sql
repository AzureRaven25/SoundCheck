-- Listening taste imported from a Spotify export. The browser unzips the export and sends only a summary:
-- per-track and per-artist play counts, time listened, skip rate and last played (never the raw streams, IPs or
-- devices). Owner-only; deleting the taste_imports row removes everything. Matched to the catalog here and used
-- by recommended_tracks() for "Picked for you" and the "From your Spotify" shelf.

create table public.taste_imports (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  source          text not null check (source in ('spotify')),
  imported_at     timestamptz not null default now(),
  first_played    timestamptz,
  last_played     timestamptz,
  streams         integer not null default 0 check (streams >= 0),
  ms_played       bigint not null default 0 check (ms_played >= 0),
  track_count     integer not null default 0,
  artist_count    integer not null default 0,
  matched_tracks  integer not null default 0,
  matched_artists integer not null default 0
);
comment on table public.taste_imports is 'One imported listening summary per user (Spotify export). Owner-only; written by import_taste().';

create table public.taste_tracks (
  user_id     uuid not null references public.taste_imports (user_id) on delete cascade,
  rank        integer not null check (rank > 0),          -- 1 = most listened
  title       text not null check (length(title) between 1 and 500),
  artist      text not null check (length(artist) between 1 and 500),
  album       text check (length(album) <= 500),
  spotify_uri text check (spotify_uri ~ '^spotify:track:[A-Za-z0-9]{10,40}$'),
  plays       integer not null check (plays >= 0),         -- streams of 30 s or more
  streams     integer not null check (streams >= 0),
  ms_played   bigint not null check (ms_played >= 0),
  skip_rate   real not null check (skip_rate between 0 and 1),
  last_played timestamptz not null,
  track_id    uuid references public.tracks (id) on delete set null,
  primary key (user_id, rank)
);
create index taste_tracks_track_idx on public.taste_tracks (user_id, track_id) where track_id is not null;

create table public.taste_artists (
  user_id     uuid not null references public.taste_imports (user_id) on delete cascade,
  name        text not null check (length(name) between 1 and 500),
  plays       integer not null check (plays >= 0),
  streams     integer not null check (streams >= 0),
  ms_played   bigint not null check (ms_played >= 0),
  skip_rate   real not null check (skip_rate between 0 and 1),
  last_played timestamptz not null,
  track_count integer not null default 0 check (track_count >= 0),
  artist_id   uuid references public.artists (id) on delete set null,
  primary key (user_id, name)
);
create index taste_artists_artist_idx on public.taste_artists (user_id, artist_id) where artist_id is not null;

alter table public.taste_imports enable row level security;
alter table public.taste_tracks enable row level security;
alter table public.taste_artists enable row level security;
-- read and delete your own; writes go through import_taste(), which only ever writes the caller's rows
create policy "read own taste" on public.taste_imports for select to authenticated using (user_id = (select auth.uid()));
create policy "delete own taste" on public.taste_imports for delete to authenticated using (user_id = (select auth.uid()));
create policy "read own taste tracks" on public.taste_tracks for select to authenticated using (user_id = (select auth.uid()));
create policy "read own taste artists" on public.taste_artists for select to authenticated using (user_id = (select auth.uid()));

-- Artist lookup by normalized name (the trigram index can't serve equality).
create index if not exists artists_norm_idx on public.artists (private.norm(name));

-- "Song - Remastered 2011", "Song (feat. X)" → "song": Spotify's version suffixes, so the catalog's plain title matches.
create or replace function private.base_title(text) returns text
language sql immutable parallel safe set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(private.norm($1),
    '\s*[\(\[](feat\.?|ft\.?|featuring|with) [^\)\]]*[\)\]]', '', 'g'),
    '\s+-\s+[^-]*(remaster|version|edit|mono|stereo|live|mix|demo|acoustic|recorded|anniversary|deluxe|from )[^-]*$', ''))
$$;

-- Link a user's imported tracks and artists to the catalog (Spotify id, then title + artist).
create or replace function private.match_taste(uid uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.taste_artists ta set artist_id = (
    select a.id from public.artists a where private.norm(a.name) = private.norm(ta.name) order by a.popularity desc limit 1)
  where ta.user_id = uid;

  update public.taste_tracks tt set track_id = coalesce(
    (select s.track_id from public.track_sources s
      where tt.spotify_uri is not null and s.provider = 'spotify' and s.external_id = split_part(tt.spotify_uri, ':', 3) limit 1),
    (select t.id from public.tracks t
      where t.norm_title in (private.norm(tt.title), private.base_title(tt.title))
        and (t.norm_artist = private.norm(tt.artist)
             or left(t.norm_artist, length(private.norm(tt.artist)) + 1) = private.norm(tt.artist) || ' '  -- "x & y", "x feat. y"
             or exists (select 1 from public.track_artists x join public.artists a on a.id = x.artist_id
                         where x.track_id = t.id and private.norm(a.name) = private.norm(tt.artist)))
      order by (t.norm_artist = private.norm(tt.artist)) desc, (t.norm_title = private.norm(tt.title)) desc, t.popularity desc
      limit 1))
  where tt.user_id = uid;

  update public.taste_imports i set
    matched_tracks = (select count(*) from public.taste_tracks where user_id = uid and track_id is not null),
    matched_artists = (select count(*) from public.taste_artists where user_id = uid and artist_id is not null)
  where i.user_id = uid;
end;
$$;
revoke execute on function private.match_taste(uuid) from public, anon, authenticated;

-- Replace the caller's imported taste with a new summary (shape: apps/web/src/lib/spotify/history.ts TasteSummary).
create or replace function public.import_taste(p_summary jsonb)
returns public.taste_imports
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.taste_imports;
begin
  if uid is null then raise exception 'Sign in to import your listening history' using errcode = '42501'; end if;
  if jsonb_typeof(p_summary -> 'tracks') is distinct from 'array' or jsonb_typeof(p_summary -> 'artists') is distinct from 'array' then
    raise exception 'Expected a listening summary with tracks and artists' using errcode = '22023';
  end if;
  if jsonb_array_length(p_summary -> 'tracks') > 2000 or jsonb_array_length(p_summary -> 'artists') > 500 then
    raise exception 'Summary too large (at most 2000 tracks and 500 artists)' using errcode = '22023';
  end if;
  if coalesce(p_summary ->> 'source', 'spotify') <> 'spotify' then raise exception 'Unknown source' using errcode = '22023'; end if;

  delete from public.taste_imports where user_id = uid;
  insert into public.taste_imports (user_id, source, first_played, last_played, streams, ms_played)
  values (uid, 'spotify', (p_summary ->> 'first_played')::timestamptz, (p_summary ->> 'last_played')::timestamptz,
          greatest(0, coalesce((p_summary ->> 'streams')::integer, 0)), greatest(0, coalesce((p_summary ->> 'ms_played')::bigint, 0)));

  insert into public.taste_tracks (user_id, rank, title, artist, album, spotify_uri, plays, streams, ms_played, skip_rate, last_played)
  select uid, x.ord::integer, left(btrim(x.e ->> 'title'), 500), left(btrim(x.e ->> 'artist'), 500), left(nullif(btrim(x.e ->> 'album'), ''), 500),
         case when x.e ->> 'spotify_uri' ~ '^spotify:track:[A-Za-z0-9]{10,40}$' then x.e ->> 'spotify_uri' end,
         greatest(0, coalesce((x.e ->> 'plays')::integer, 0)), greatest(0, coalesce((x.e ->> 'streams')::integer, 0)),
         greatest(0, coalesce((x.e ->> 'ms_played')::bigint, 0)), least(1, greatest(0, coalesce((x.e ->> 'skip_rate')::real, 0))),
         coalesce((x.e ->> 'last_played')::timestamptz, now())
    from jsonb_array_elements(p_summary -> 'tracks') with ordinality as x(e, ord)
   where nullif(btrim(x.e ->> 'title'), '') is not null and nullif(btrim(x.e ->> 'artist'), '') is not null;

  insert into public.taste_artists (user_id, name, plays, streams, ms_played, skip_rate, last_played, track_count)
  select uid, left(btrim(e ->> 'name'), 500),
         greatest(0, coalesce((e ->> 'plays')::integer, 0)), greatest(0, coalesce((e ->> 'streams')::integer, 0)),
         greatest(0, coalesce((e ->> 'ms_played')::bigint, 0)), least(1, greatest(0, coalesce((e ->> 'skip_rate')::real, 0))),
         coalesce((e ->> 'last_played')::timestamptz, now()), greatest(0, coalesce((e ->> 'track_count')::integer, 0))
    from jsonb_array_elements(p_summary -> 'artists') e
   where nullif(btrim(e ->> 'name'), '') is not null
  on conflict (user_id, name) do nothing;

  update public.taste_imports set
    track_count = (select count(*) from public.taste_tracks where user_id = uid),
    artist_count = (select count(*) from public.taste_artists where user_id = uid)
  where user_id = uid;
  perform private.match_taste(uid);
  select * into r from public.taste_imports where user_id = uid;
  return r;
end;
$$;
grant execute on function public.import_taste(jsonb) to authenticated;
revoke execute on function public.import_taste(jsonb) from anon, public;

-- Re-run catalog matching for the caller (the catalog grows; songs missing at import time can match later).
create or replace function public.rematch_taste()
returns public.taste_imports
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid()); r public.taste_imports;
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform private.match_taste(uid);
  select * into r from public.taste_imports where user_id = uid;
  return r;
end;
$$;
grant execute on function public.rematch_taste() to authenticated;
revoke execute on function public.rematch_taste() from anon, public;

-- "Picked for you": songs by the artists you like most, weighted from
--   * plays here (last 200, 1 each) and favorites (2 each), credited to every artist on the track
--   * the imported Spotify summary: up to 8 for your most-played artist (log of plays), less for skipped or long-ago artists
-- skipping songs you've already played, favorited, or play a lot on Spotify (those get their own shelf),
-- round-robin across artists so one prolific artist doesn't fill the shelf.
create or replace function public.recommended_tracks(p_limit integer default 12)
returns table (track_id uuid, artist_id uuid, artist_name text, weight double precision)
language sql stable security invoker set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  app as (
    select h.track_id, 1.0::float8 as w
      from (select lh.track_id from public.listening_history lh, me where lh.user_id = me.uid order by lh.played_at desc limit 200) h
    union all
    select f.track_id, 2.0 from public.favorites f, me where f.user_id = me.uid
  ),
  imported as (
    select ta.artist_id,
           8.0 * ln(1 + ta.plays) / ln(2 + max(ta.plays) over ())
             * (1 - 0.5 * ta.skip_rate)
             * (0.4 + 0.6 * exp(-greatest(0, extract(epoch from now() - ta.last_played)) / (86400.0 * 365))) as w
      from public.taste_artists ta, me where ta.user_id = me.uid and ta.artist_id is not null and ta.plays > 0
  ),
  weights as (
    select artist_id, sum(w) as w from (
      select x.artist_id, a.w * case when x.position = 0 then 1.0 else 0.5 end as w
        from app a join public.track_artists x on x.track_id = a.track_id
      union all
      select artist_id, w from imported
    ) s group by artist_id
    order by sum(w) desc limit 10
  ),
  heard as (
    select track_id from app
    union
    select tt.track_id from public.taste_tracks tt, me where tt.user_id = me.uid and tt.track_id is not null and tt.plays >= 3
  ),
  candidates as (
    select distinct on (t.id) t.id, w.artist_id, w.w, t.popularity
      from weights w join public.track_artists x on x.artist_id = w.artist_id join public.tracks t on t.id = x.track_id
     where not exists (select 1 from heard h where h.track_id = t.id)
     order by t.id, w.w desc
  ),
  ranked as (
    select c.*, row_number() over (partition by c.artist_id order by c.popularity desc, c.id) as rn from candidates c
  )
  select r.id, r.artist_id, a.name, r.w
    from ranked r join public.artists a on a.id = r.artist_id
   where r.rn <= 6
   order by r.rn, r.w desc, r.popularity desc
   limit least(greatest(coalesce(p_limit, 12), 1), 50)
$$;
grant execute on function public.recommended_tracks(integer) to authenticated;
revoke execute on function public.recommended_tracks(integer) from anon, public;
