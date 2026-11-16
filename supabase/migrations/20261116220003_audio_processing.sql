-- SoundCheck M1 · 3/6 · Playable audio, karaoke analysis, processing jobs + queue.

create extension if not exists pgmq;

-- ---------------------------------------------------------------- audio assets
create table public.audio_assets (
  id              uuid primary key default gen_random_uuid(),
  track_id        uuid not null references public.tracks (id) on delete cascade,
  owner_id        uuid references auth.users (id) on delete cascade,     -- null = shared/licensed asset
  kind            text not null check (kind in ('original', 'instrumental', 'vocals', 'preview')),
  provider        text not null check (provider in ('upload', 'itunes_preview', 'licensed', 'pipeline')),
  storage_path    text,                                                   -- object in the `audio` bucket
  external_url    text,                                                   -- e.g. a 30 s preview URL
  source_asset_id uuid references public.audio_assets (id) on delete cascade,  -- stems point at their original
  mime_type       text,
  duration_ms     integer check (duration_ms > 0),
  bitrate_kbps    integer check (bitrate_kbps > 0),
  fingerprint     text,                                                   -- Chromaprint, for dedupe
  created_at      timestamptz not null default now(),
  check (storage_path is not null or external_url is not null),
  check (kind = 'original' or kind = 'preview' or source_asset_id is not null)
);
create index audio_assets_track_idx on public.audio_assets (track_id);
create index audio_assets_owner_idx on public.audio_assets (owner_id);
create index audio_assets_source_idx on public.audio_assets (source_asset_id);
create index audio_assets_fingerprint_idx on public.audio_assets (fingerprint) where fingerprint is not null;

create or replace function private.can_read_asset(a uuid) returns boolean
  language sql stable security definer set search_path = ''
  as $$
    select exists (
      select 1 from public.audio_assets
      where id = a and (owner_id is null or owner_id = (select auth.uid()))
    )
  $$;

alter table public.audio_assets enable row level security;
create policy "read own or shared audio" on public.audio_assets for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "previews are public" on public.audio_assets for select to anon
  using (owner_id is null and kind = 'preview');
-- Users register their own uploads (original only, inside their own Storage folder). Stems come from the worker.
create policy "register own uploads" on public.audio_assets for insert to authenticated
  with check (
    owner_id = (select auth.uid()) and kind = 'original' and provider = 'upload'
    and storage_path like (select auth.uid())::text || '/%'
  );
create policy "delete own uploads" on public.audio_assets for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- karaoke analysis (pipeline output)
create table public.karaoke_analysis (
  id                uuid primary key default gen_random_uuid(),
  track_id          uuid not null references public.tracks (id) on delete cascade,
  source_asset_id   uuid not null unique references public.audio_assets (id) on delete cascade,
  pipeline_version  text not null,
  separation_model  text not null,
  pitch_model       text not null,
  musical_key       text,                       -- e.g. "Eb major"
  tempo_bpm         real check (tempo_bpm > 0),
  vocal_range       jsonb,                      -- {"low":60,"high":72,"min":59,"max":74}
  notes             jsonb not null check (jsonb_typeof(notes) = 'array'),    -- [{start,end,pitch,conf}]
  phrases           jsonb not null default '[]'::jsonb check (jsonb_typeof(phrases) = 'array'),
  contour_path      text,                       -- 10 ms contour (large) lives in Storage
  created_at        timestamptz not null default now()
);
create index karaoke_analysis_track_idx on public.karaoke_analysis (track_id);
alter table public.karaoke_analysis enable row level security;
create policy "read analysis of readable audio" on public.karaoke_analysis for select to authenticated
  using (private.can_read_asset(source_asset_id));

-- ---------------------------------------------------------------- processing jobs
create table public.processing_jobs (
  id            uuid primary key default gen_random_uuid(),
  track_id      uuid not null references public.tracks (id) on delete cascade,
  asset_id      uuid not null references public.audio_assets (id) on delete cascade,
  requested_by  uuid references auth.users (id) on delete set null,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'canceled')),
  stage         text,                          -- separate | melody | lyrics | align | encode | upload
  progress      real not null default 0 check (progress between 0 and 1),
  error         text,
  attempts      smallint not null default 0,
  worker        text,
  queue_msg_id  bigint,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create unique index processing_jobs_one_active_idx on public.processing_jobs (asset_id) where status in ('queued', 'running');
create index processing_jobs_requester_idx on public.processing_jobs (requested_by, created_at desc);
alter table public.processing_jobs enable row level security;
create policy "see own jobs" on public.processing_jobs for select to authenticated
  using (requested_by = (select auth.uid()) or private.can_read_asset(asset_id));

select pgmq.create('audio_processing');

-- Ask for an original to be turned into karaoke assets. Idempotent: returns the existing
-- analysis-backed state or the active job instead of queueing duplicates.
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
                                                          'track_id', v_asset.track_id, 'storage_path', v_asset.storage_path))
    into v_msg;
  update public.processing_jobs set queue_msg_id = v_msg where id = v_job.id;
  return query select v_job.id, 'queued'::text, null::uuid;
end
$$;
revoke all on function public.request_processing from public, anon;
grant execute on function public.request_processing to authenticated;

-- Worker-facing queue API (service role only; workers never get a database password).
create or replace function public.worker_claim_jobs(p_worker text, p_visibility_seconds integer default 900, p_qty integer default 1)
returns table (msg_id bigint, read_ct integer, job jsonb)
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select * from pgmq.read('audio_processing', p_visibility_seconds, p_qty) loop
    update public.processing_jobs
       set status = 'running', started_at = coalesce(started_at, now()), attempts = attempts + 1, worker = p_worker
     where id = (r.message ->> 'job_id')::uuid and status in ('queued', 'running');
    msg_id := r.msg_id; read_ct := r.read_ct; job := r.message;
    return next;
  end loop;
end
$$;

create or replace function public.worker_update_job(p_job_id uuid, p_stage text, p_progress real)
returns void language sql security definer set search_path = ''
as $$ update public.processing_jobs set stage = p_stage, progress = p_progress where id = p_job_id and status = 'running' $$;

create or replace function public.worker_finish_job(p_msg_id bigint, p_job_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.processing_jobs
     set status = case when p_ok then 'done' else 'failed' end,
         progress = case when p_ok then 1 else progress end,
         error = p_error, finished_at = now()
   where id = p_job_id;
  perform pgmq.archive('audio_processing', p_msg_id);
end
$$;

revoke all on function public.worker_claim_jobs, public.worker_update_job, public.worker_finish_job from public, anon, authenticated;
grant execute on function public.worker_claim_jobs, public.worker_update_job, public.worker_finish_job to service_role;
