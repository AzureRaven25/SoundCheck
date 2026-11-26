-- Auto sync, part 2.
-- 1. A singer's measured offset and their hand nudges are kept apart (one row each), so nudging after a measurement
--    doesn't erase it: video_offsets weighs both.
-- 2. Every auto-sync attempt is logged (match strength, shift, how far it got) so the thresholds can be tuned from
--    real rooms. No audio, only these numbers.
alter table public.video_sync drop constraint video_sync_pkey;
alter table public.video_sync add primary key (track_id, video_id, user_id, measured);

create or replace function public.set_video_offset(p_track_id uuid, p_video_id text, p_offset_ms integer, p_measured boolean default false)
returns void
language sql security invoker set search_path = ''
as $$
  insert into public.video_sync (track_id, video_id, offset_ms, measured) values (p_track_id, p_video_id, p_offset_ms, p_measured)
  on conflict (track_id, video_id, user_id, measured) do update set offset_ms = excluded.offset_ms, updated_at = now()
$$;

create table private.video_sync_attempts (
  id          bigint generated always as identity primary key,
  track_id    uuid not null references public.tracks (id) on delete cascade,
  video_id    text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  user_id     uuid references auth.users (id) on delete set null,
  outcome     text not null check (outcome in ('ok', 'low-confidence', 'no-mic', 'skipped', 'original-did-not-play', 'karaoke-did-not-play', 'error')),
  guess_ms    integer,
  offset_ms   integer,
  score       real,
  margin      real,
  ref_frames  integer,
  cand_frames integer,
  level_db    real,
  created_at  timestamptz not null default now()
);
create index video_sync_attempts_video_idx on private.video_sync_attempts (track_id, video_id, created_at desc);

create or replace function public.log_video_sync_attempt(
  p_track_id uuid, p_video_id text, p_outcome text, p_guess_ms integer, p_offset_ms integer,
  p_score real, p_margin real, p_ref_frames integer, p_cand_frames integer, p_level_db real)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  -- a light brake on junk: at most 30 a minute overall
  if (select count(*) from private.video_sync_attempts where created_at > now() - interval '1 minute') >= 30 then return; end if;
  insert into private.video_sync_attempts (track_id, video_id, user_id, outcome, guess_ms, offset_ms, score, margin, ref_frames, cand_frames, level_db)
  values (p_track_id, p_video_id, auth.uid(), p_outcome, p_guess_ms, p_offset_ms, p_score, p_margin, p_ref_frames, p_cand_frames, p_level_db);
end;
$$;
revoke execute on function public.log_video_sync_attempt(uuid, text, text, integer, integer, real, real, integer, integer, real) from public;
grant execute on function public.log_video_sync_attempt(uuid, text, text, integer, integer, real, real, integer, integer, real) to anon, authenticated;
