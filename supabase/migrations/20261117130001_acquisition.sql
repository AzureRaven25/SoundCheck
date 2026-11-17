-- Acquisition layer: more full-length sources, provenance and quality per source, duplicate detection for
-- imported files, bulk import of music the user owns, and a log of what was tried and why it failed.
-- research.md §8 records which sources were accepted and which were rejected.

-- ---------------------------------------------------------------- more providers
alter table public.track_sources drop constraint track_sources_provider_check;
alter table public.track_sources add constraint track_sources_provider_check
  check (provider in ('musicbrainz', 'itunes', 'internet_archive', 'youtube', 'apple_music', 'spotify', 'jamendo', 'audius', 'ccmixter', 'openverse', 'deezer'));
alter table public.track_sources
  add column format       text,                 -- mp3, flac, ogg, aac …
  add column bitrate_kbps integer check (bitrate_kbps > 0),
  add column imported_by  uuid references auth.users (id) on delete set null;

alter table public.audio_assets drop constraint audio_assets_provider_check;
alter table public.audio_assets add constraint audio_assets_provider_check
  check (provider in ('upload', 'itunes_preview', 'licensed', 'pipeline', 'internet_archive', 'audius', 'ccmixter', 'jamendo', 'openverse'));
alter table public.audio_assets
  add column content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  add column source_label   text check (length(source_label) <= 200);  -- provenance of an upload: "Bandcamp purchase", "CD rip" …
create unique index audio_assets_owner_hash_idx on public.audio_assets (owner_id, content_sha256)
  where content_sha256 is not null;

alter table public.artwork drop constraint artwork_provider_check;
alter table public.artwork add constraint artwork_provider_check
  check (provider in ('coverartarchive', 'itunes', 'spotify_oembed', 'cov_manual', 'upload', 'deezer', 'internet_archive',
                      'wikimedia', 'audius', 'ccmixter', 'jamendo', 'openverse'));

-- who added a catalog row that came from an import (null = catalog sync)
alter table public.tracks add column created_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------- matching an imported file to the catalog
-- Same normalized title and artist, and (when both are known) durations within 4 s: the same recording.
create or replace function private.match_track(p_title text, p_artist text, p_duration_ms integer)
returns uuid language sql stable set search_path = ''
as $$
  select t.id from public.tracks t
   where t.norm_title = private.norm(p_title) and t.norm_artist = private.norm(p_artist)
     and (p_duration_ms is null or t.duration_ms is null or abs(t.duration_ms - p_duration_ms) <= 4000)
   order by (t.duration_ms is not null and p_duration_ms is not null) desc, t.popularity desc
   limit 1
$$;

/**
 * Import a song the user owns (their file, a Bandcamp purchase, a CD rip): find its catalog row or create one.
 * Only metadata goes into the shared catalog; the audio stays in the user's private Storage folder.
 */
create or replace function public.import_owned_track(p_title text, p_artist text, p_album text default null,
                                                     p_duration_ms integer default null, p_year integer default null)
returns table (track_id uuid, created boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_album uuid;
  v_title text := left(btrim(coalesce(p_title, '')), 500);
  v_artist text := left(btrim(coalesce(p_artist, '')), 500);
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if v_title = '' then raise exception 'a title is required' using errcode = '22023'; end if;
  if v_artist = '' then v_artist := 'Unknown artist'; end if;
  if p_duration_ms is not null and (p_duration_ms <= 0 or p_duration_ms > 3 * 3600 * 1000) then p_duration_ms := null; end if;
  if p_year is not null and (p_year < 1800 or p_year > 2200) then p_year := null; end if;

  v_id := private.match_track(v_title, v_artist, p_duration_ms);
  if v_id is not null then
    return query select v_id, false;
    return;
  end if;

  -- abuse guard: new catalog rows per user per day
  if (select count(*) from public.tracks where created_by = v_uid and created_at > now() - interval '1 day') >= 2000 then
    raise exception 'import limit reached for today' using errcode = '54000';
  end if;

  if nullif(btrim(p_album), '') is not null then
    select a.id into v_album from public.albums a
     where private.norm(a.title) = private.norm(p_album) and private.norm(a.artist_credit) = private.norm(v_artist) limit 1;
    if v_album is null then
      insert into public.albums (title, artist_credit, primary_type, release_year)
      values (left(btrim(p_album), 500), v_artist, 'album', p_year) returning id into v_album;
    end if;
  end if;

  insert into public.tracks (title, artist_credit, album_id, duration_ms, release_year, created_by)
  values (v_title, v_artist, v_album, p_duration_ms, p_year, v_uid)
  returning id into v_id;
  return query select v_id, true;
end
$$;
revoke all on function public.import_owned_track from public, anon;
grant execute on function public.import_owned_track to authenticated;

-- ---------------------------------------------------------------- acquisition log
create table public.acquisition_log (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  provider    text not null,
  action      text not null check (action in ('search', 'import', 'prepare', 'upload')),
  external_id text,
  track_id    uuid references public.tracks (id) on delete set null,
  ok          boolean not null,
  error       text,
  created_at  timestamptz not null default now()
);
create index acquisition_log_user_idx on public.acquisition_log (user_id, created_at desc);
alter table public.acquisition_log enable row level security;
create policy "read own acquisition log" on public.acquisition_log for select to authenticated
  using (user_id = (select auth.uid()));
create policy "log own uploads" on public.acquisition_log for insert to authenticated
  with check (user_id = (select auth.uid()) and action = 'upload' and provider = 'upload');

-- the acquire Edge Function (service role) matches provider results against the catalog the same way
create or replace function public.acquire_match_track(p_title text, p_artist text, p_duration_ms integer)
returns uuid language sql stable security definer set search_path = ''
as $$ select private.match_track(p_title, p_artist, p_duration_ms) $$;
revoke all on function public.acquire_match_track from public, anon, authenticated;
grant execute on function public.acquire_match_track to service_role;

-- ---------------------------------------------------------------- source availability per track
-- What a viewer can actually do with each song, strongest first:
--   karaoke_ready  a processed karaoke version exists that this viewer may use
--   karaoke_ok     a complete recording exists that we may process (open license, or the viewer's own copy)
--   full           a complete recording can be played (own copy, open source, or a provider's full stream)
--   preview        only a short clip
--   catalog        metadata only
-- Runs as the caller, so private uploads count only for their owner (RLS).
create or replace function public.track_availability(p_ids uuid[])
returns table (track_id uuid, level text, full_sources text[], karaoke_ok boolean, karaoke_ready boolean, has_preview boolean)
language sql stable security invoker set search_path = ''
as $$
  with ids as (select distinct unnest(p_ids[1:200]) as id),
  src as (
    select s.track_id, array_agg(distinct s.provider) filter (where s.stream_url is not null) as full_sources,
           bool_or(s.karaoke_ok and s.stream_url is not null) as karaoke_ok
      from public.track_sources s where s.track_id in (select id from ids) group by s.track_id
  ),
  own as (
    select a.track_id, bool_or(a.kind = 'original' and a.storage_path is not null) as own_copy,
           bool_or(a.kind = 'preview') as preview
      from public.audio_assets a where a.track_id in (select id from ids) group by a.track_id
  ),
  ready as (
    select distinct k.track_id from public.karaoke_analysis k
      join public.audio_assets a on a.id = k.source_asset_id
     where k.track_id in (select id from ids)
  )
  select i.id,
         case when r.track_id is not null then 'karaoke_ready'
              when coalesce(s.karaoke_ok, false) or coalesce(o.own_copy, false) then 'karaoke_ok'
              when coalesce(array_length(s.full_sources, 1), 0) > 0 then 'full'
              when coalesce(o.preview, false) then 'preview'
              else 'catalog' end,
         coalesce(s.full_sources, '{}') || case when coalesce(o.own_copy, false) then array['upload'] else '{}'::text[] end,
         coalesce(s.karaoke_ok, false) or coalesce(o.own_copy, false),
         r.track_id is not null,
         coalesce(o.preview, false)
    from ids i left join src s on s.track_id = i.id left join own o on o.track_id = i.id left join ready r on r.track_id = i.id
$$;
grant execute on function public.track_availability to anon, authenticated;
