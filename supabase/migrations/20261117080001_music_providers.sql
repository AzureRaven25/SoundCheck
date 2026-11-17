-- Music providers: where each song's audio can come from, what that provider allows, and open-licensed
-- full-length audio (Internet Archive) as a source for both listening and karaoke.

-- ---------------------------------------------------------------- provider identifiers per track
create table public.track_sources (
  id           uuid primary key default gen_random_uuid(),
  track_id     uuid not null references public.tracks (id) on delete cascade,
  provider     text not null check (provider in ('musicbrainz', 'itunes', 'internet_archive', 'youtube', 'apple_music', 'spotify', 'jamendo')),
  external_id  text not null,                 -- e.g. "<archive item>/<file name>", a YouTube video id, an Apple catalog id
  url          text,                          -- page to credit / open (never a hidden stream URL for DRM services)
  stream_url   text,                          -- direct full-length file, only for providers that permit it
  duration_ms  integer check (duration_ms > 0),
  license_url  text,                          -- e.g. a Creative Commons deed
  attribution  text,
  karaoke_ok   boolean not null default false, -- may we derive stems from this audio?
  created_at   timestamptz not null default now(),
  unique (provider, external_id)
);
create index track_sources_track_idx on public.track_sources (track_id);
alter table public.track_sources enable row level security;
create policy "track sources are public" on public.track_sources for select to anon, authenticated using (true);
-- written only by Edge Functions (service role)

-- ---------------------------------------------------------------- open-licensed originals
alter table public.audio_assets drop constraint audio_assets_provider_check;
alter table public.audio_assets add constraint audio_assets_provider_check
  check (provider in ('upload', 'itunes_preview', 'licensed', 'pipeline', 'internet_archive'));
alter table public.audio_assets add column license_url text;

alter table public.artwork drop constraint artwork_provider_check;
alter table public.artwork add constraint artwork_provider_check
  check (provider in ('coverartarchive', 'itunes', 'spotify_oembed', 'cov_manual', 'upload', 'deezer', 'internet_archive'));

-- ---------------------------------------------------------------- jobs can start from a permitted URL
-- (the worker downloads only from allow-listed hosts; uploads keep using private Storage)
create or replace function public.request_processing(p_asset_id uuid)
returns table (job_id uuid, status text, analysis_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  v_asset public.audio_assets;
  v_job   public.processing_jobs;
  v_analysis uuid;
  v_msg   bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in required' using errcode = '28000';
  end if;
  select * into v_asset from public.audio_assets
   where id = p_asset_id and kind = 'original' and (owner_id is null or owner_id = (select auth.uid()));
  if not found then
    raise exception 'audio asset not found' using errcode = 'P0002';
  end if;

  select id into v_analysis from public.karaoke_analysis where source_asset_id = p_asset_id;
  if v_analysis is not null then
    return query select null::uuid, 'done'::text, v_analysis;
    return;
  end if;

  select * into v_job from public.processing_jobs
   where asset_id = p_asset_id and processing_jobs.status in ('queued', 'running');
  if found then
    return query select v_job.id, v_job.status, null::uuid;
    return;
  end if;

  insert into public.processing_jobs (track_id, asset_id, requested_by)
  values (v_asset.track_id, v_asset.id, (select auth.uid()))
  returning * into v_job;

  select pgmq.send('audio_processing', jsonb_build_object('job_id', v_job.id, 'asset_id', v_asset.id,
                                                          'track_id', v_asset.track_id, 'storage_path', v_asset.storage_path,
                                                          'external_url', v_asset.external_url))
    into v_msg;
  update public.processing_jobs set queue_msg_id = v_msg where id = v_job.id;
  return query select v_job.id, 'queued'::text, null::uuid;
end
$$;
revoke all on function public.request_processing from public, anon;
grant execute on function public.request_processing to authenticated;
