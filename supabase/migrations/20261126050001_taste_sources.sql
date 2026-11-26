-- Listening taste from more services: Apple Music, YouTube Music, Deezer and Last.fm alongside Spotify.
-- One summary per user per service (importing one service no longer replaces another), still owner-only.

alter table public.taste_tracks drop constraint taste_tracks_user_id_fkey;
alter table public.taste_artists drop constraint taste_artists_user_id_fkey;
alter table public.taste_tracks drop constraint taste_tracks_pkey;
alter table public.taste_artists drop constraint taste_artists_pkey;
alter table public.taste_imports drop constraint taste_imports_pkey;

alter table public.taste_imports drop constraint taste_imports_source_check;
alter table public.taste_imports add constraint taste_imports_source_check
  check (source in ('spotify', 'apple_music', 'youtube_music', 'deezer', 'lastfm'));
alter table public.taste_imports add primary key (user_id, source);

alter table public.taste_tracks add column source text not null default 'spotify';
alter table public.taste_artists add column source text not null default 'spotify';
alter table public.taste_tracks alter column source drop default;
alter table public.taste_artists alter column source drop default;
alter table public.taste_tracks add primary key (user_id, source, rank);
alter table public.taste_artists add primary key (user_id, source, name);
alter table public.taste_tracks add constraint taste_tracks_import_fkey
  foreign key (user_id, source) references public.taste_imports (user_id, source) on delete cascade;
alter table public.taste_artists add constraint taste_artists_import_fkey
  foreign key (user_id, source) references public.taste_imports (user_id, source) on delete cascade;
comment on table public.taste_imports is 'One imported listening summary per user per service. Owner-only; written by import_taste().';

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
             or left(t.norm_artist, length(private.norm(tt.artist)) + 1) = private.norm(tt.artist) || ' '
             or exists (select 1 from public.track_artists x join public.artists a on a.id = x.artist_id
                         where x.track_id = t.id and private.norm(a.name) = private.norm(tt.artist)))
      order by (t.norm_artist = private.norm(tt.artist)) desc, (t.norm_title = private.norm(tt.title)) desc, t.popularity desc
      limit 1))
  where tt.user_id = uid;

  update public.taste_imports i set
    matched_tracks = (select count(*) from public.taste_tracks t where t.user_id = uid and t.source = i.source and t.track_id is not null),
    matched_artists = (select count(*) from public.taste_artists a where a.user_id = uid and a.source = i.source and a.artist_id is not null)
  where i.user_id = uid;
end;
$$;
revoke execute on function private.match_taste(uuid) from public, anon, authenticated;

-- Replace the caller's summary for one service (shape: apps/web/src/lib/taste/summary.ts TasteSummary).
create or replace function public.import_taste(p_summary jsonb)
returns public.taste_imports
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  src text := coalesce(p_summary ->> 'source', 'spotify');
  r public.taste_imports;
begin
  if uid is null then raise exception 'Sign in to import your listening history' using errcode = '42501'; end if;
  if src not in ('spotify', 'apple_music', 'youtube_music', 'deezer', 'lastfm') then raise exception 'Unknown source' using errcode = '22023'; end if;
  if jsonb_typeof(p_summary -> 'tracks') is distinct from 'array' or jsonb_typeof(p_summary -> 'artists') is distinct from 'array' then
    raise exception 'Expected a listening summary with tracks and artists' using errcode = '22023';
  end if;
  if jsonb_array_length(p_summary -> 'tracks') > 2000 or jsonb_array_length(p_summary -> 'artists') > 500 then
    raise exception 'Summary too large (at most 2000 tracks and 500 artists)' using errcode = '22023';
  end if;

  delete from public.taste_imports where user_id = uid and source = src;
  insert into public.taste_imports (user_id, source, first_played, last_played, streams, ms_played)
  values (uid, src, (p_summary ->> 'first_played')::timestamptz, (p_summary ->> 'last_played')::timestamptz,
          greatest(0, coalesce((p_summary ->> 'streams')::integer, 0)), greatest(0, coalesce((p_summary ->> 'ms_played')::bigint, 0)));

  insert into public.taste_tracks (user_id, source, rank, title, artist, album, spotify_uri, plays, streams, ms_played, skip_rate, last_played)
  select uid, src, x.ord::integer, left(btrim(x.e ->> 'title'), 500), left(btrim(x.e ->> 'artist'), 500), left(nullif(btrim(x.e ->> 'album'), ''), 500),
         case when x.e ->> 'spotify_uri' ~ '^spotify:track:[A-Za-z0-9]{10,40}$' then x.e ->> 'spotify_uri' end,
         greatest(0, coalesce((x.e ->> 'plays')::integer, 0)), greatest(0, coalesce((x.e ->> 'streams')::integer, 0)),
         greatest(0, coalesce((x.e ->> 'ms_played')::bigint, 0)), least(1, greatest(0, coalesce((x.e ->> 'skip_rate')::real, 0))),
         coalesce((x.e ->> 'last_played')::timestamptz, now())
    from jsonb_array_elements(p_summary -> 'tracks') with ordinality as x(e, ord)
   where nullif(btrim(x.e ->> 'title'), '') is not null and nullif(btrim(x.e ->> 'artist'), '') is not null;

  insert into public.taste_artists (user_id, source, name, plays, streams, ms_played, skip_rate, last_played, track_count)
  select uid, src, left(btrim(e ->> 'name'), 500),
         greatest(0, coalesce((e ->> 'plays')::integer, 0)), greatest(0, coalesce((e ->> 'streams')::integer, 0)),
         greatest(0, coalesce((e ->> 'ms_played')::bigint, 0)), least(1, greatest(0, coalesce((e ->> 'skip_rate')::real, 0))),
         coalesce((e ->> 'last_played')::timestamptz, now()), greatest(0, coalesce((e ->> 'track_count')::integer, 0))
    from jsonb_array_elements(p_summary -> 'artists') e
   where nullif(btrim(e ->> 'name'), '') is not null
  on conflict (user_id, source, name) do nothing;

  update public.taste_imports set
    track_count = (select count(*) from public.taste_tracks where user_id = uid and source = src),
    artist_count = (select count(*) from public.taste_artists where user_id = uid and source = src)
  where user_id = uid and source = src;
  perform private.match_taste(uid);
  select * into r from public.taste_imports where user_id = uid and source = src;
  return r;
end;
$$;

drop function if exists public.rematch_taste();
create function public.rematch_taste()
returns setof public.taste_imports
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  perform private.match_taste(uid);
  return query select * from public.taste_imports where user_id = uid;
end;
$$;
grant execute on function public.rematch_taste() to authenticated;
revoke execute on function public.rematch_taste() from anon, public;

-- Same ranking as before, with each service's artists scaled to that service's most-played artist and then
-- added up, so an artist you play on two services counts more and one big export doesn't drown the rest.
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
           8.0 * ln(1 + ta.plays) / ln(2 + max(ta.plays) over (partition by ta.source))
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
