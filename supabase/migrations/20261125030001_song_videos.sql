-- A growing, shared database of YouTube videos to sing each song to, filled ahead of time by an hourly crawl
-- that spends the spare YouTube Data API quota (search = 100 units), plus links singers paste on Stage. Live
-- lookups read this first, so a song is searched once, not once per visitor.
--
-- YouTube's developer policies allow storing API data only if it's kept fresh: the crawl re-checks every stored
-- video at least every 30 days (videos.list, 1 unit per 50 videos) and removes ones that are gone or no longer
-- embeddable.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.song_videos (
  track_id        uuid not null references public.tracks (id) on delete cascade,
  video_id        text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  kind            text not null check (kind in ('original', 'karaoke')),
  title           text,
  channel         text,
  duration_s      integer,
  quality         real not null default 0,
  offset_guess_ms integer not null default 0,
  source          text not null check (source in ('search', 'user')),
  added_by        uuid references auth.users (id) on delete set null,
  refreshed_at    timestamptz,                -- last time YouTube confirmed it (null: not yet checked)
  created_at      timestamptz not null default now(),
  primary key (track_id, video_id)
);
create index song_videos_refresh_idx on public.song_videos (refreshed_at nulls first);
alter table public.song_videos enable row level security;
create policy "song videos are public" on public.song_videos for select to anon, authenticated using (true);
-- writes: the youtube functions (service role) and share_song_video below

-- Which songs the crawl (or a live lookup) has already searched.
create table private.youtube_searched (
  track_id    uuid primary key references public.tracks (id) on delete cascade,
  searched_at timestamptz not null default now(),
  found       integer not null default 0
);

-- Quota ledger: units spent per YouTube quota day (it resets at midnight Pacific time).
create table private.youtube_quota (
  day   date primary key,
  units integer not null default 0
);

-- Reserve units if today's total stays within p_limit. Returns true when granted. Atomic under concurrency.
create or replace function public.youtube_quota_take(p_units integer, p_limit integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare d date := (now() at time zone 'America/Los_Angeles')::date; ok boolean;
begin
  insert into private.youtube_quota (day, units) values (d, 0) on conflict (day) do nothing;
  update private.youtube_quota set units = units + p_units where day = d and units + p_units <= p_limit returning true into ok;
  return coalesce(ok, false);
end;
$$;
revoke execute on function public.youtube_quota_take(integer, integer) from public, anon, authenticated;
grant execute on function public.youtube_quota_take(integer, integer) to service_role;

create or replace function public.youtube_quota_today()
returns integer
language sql stable security definer set search_path = ''
as $$ select coalesce((select units from private.youtube_quota where day = (now() at time zone 'America/Los_Angeles')::date), 0) $$;
revoke execute on function public.youtube_quota_today() from public, anon, authenticated;
grant execute on function public.youtube_quota_today() to service_role;

-- Next songs to search: most popular first, never searched, with real title/artist.
create or replace function public.youtube_crawl_candidates(p_limit integer)
returns table (id uuid, title text, artist_credit text, duration_ms integer)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.title, t.artist_credit, t.duration_ms from public.tracks t
   where not exists (select 1 from private.youtube_searched s where s.track_id = t.id)
     and not exists (select 1 from public.song_videos v where v.track_id = t.id)
     and t.popularity > 0 and length(t.title) > 0 and t.artist_credit not ilike 'unknown%'
   order by t.popularity desc, t.id
   limit least(greatest(p_limit, 1), 100)
$$;
revoke execute on function public.youtube_crawl_candidates(integer) from public, anon, authenticated;
grant execute on function public.youtube_crawl_candidates(integer) to service_role;

create or replace function public.youtube_mark_searched(p_track_id uuid, p_found integer)
returns void
language sql security definer set search_path = ''
as $$
  insert into private.youtube_searched (track_id, found) values (p_track_id, p_found)
  on conflict (track_id) do update set searched_at = now(), found = excluded.found
$$;
revoke execute on function public.youtube_mark_searched(uuid, integer) from public, anon, authenticated;
grant execute on function public.youtube_mark_searched(uuid, integer) to service_role;

-- A singer shares a video they pasted on Stage, so nobody has to search for this song again. Its title and
-- length are filled in by the crawl's next refresh pass.
create or replace function public.share_song_video(p_track_id uuid, p_video_id text, p_kind text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in required'; end if;
  if p_kind not in ('original', 'karaoke') or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'invalid video'; end if;
  if (select count(*) from public.song_videos where added_by = uid and created_at > now() - interval '1 day') >= 50 then
    raise exception 'too many shared videos today';
  end if;
  insert into public.song_videos (track_id, video_id, kind, source, added_by, quality)
  values (p_track_id, p_video_id, p_kind, 'user', uid, 0.5)
  on conflict (track_id, video_id) do nothing;
end;
$$;
revoke execute on function public.share_song_video(uuid, text, text) from public, anon;
grant execute on function public.share_song_video(uuid, text, text) to authenticated;

-- Hourly crawl. The project URL and a random crawl token live in Vault (set once per project, never in git); where
-- they're absent (local development) the job does nothing.
select cron.schedule('youtube-crawl', '17 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/youtube-crawl',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-crawl-token', (select decrypted_secret from vault.decrypted_secrets where name = 'youtube_crawl_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000)
  where exists (select 1 from vault.decrypted_secrets where name = 'youtube_crawl_token')
    and exists (select 1 from vault.decrypted_secrets where name = 'project_url')
$job$);
