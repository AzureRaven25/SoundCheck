-- Auto sync: the Stage can now measure a karaoke video's offset by ear (mic), the first time it's sung. Measured
-- offsets are marked, so the Stage knows whether a video still needs measuring (a manual nudge alone doesn't count),
-- and they outrank hand nudges (which move in 0.25 s steps) unless many more singers nudged since.
alter table public.video_sync add column measured boolean not null default false;

drop function public.video_offsets(uuid);
create function public.video_offsets(p_track_id uuid)
returns table (video_id text, offset_ms integer, votes integer, measured integer)
language sql stable security definer set search_path = ''
as $$
  select v.video_id,
         case when count(*) filter (where v.measured) > 0
                   and count(*) filter (where not v.measured) <= 2 * count(*) filter (where v.measured)
              then (percentile_disc(0.5) within group (order by v.offset_ms) filter (where v.measured))::integer
              else (percentile_disc(0.5) within group (order by v.offset_ms))::integer end,
         count(*)::integer,
         (count(*) filter (where v.measured))::integer
    from public.video_sync v where v.track_id = p_track_id group by v.video_id
$$;
grant execute on function public.video_offsets(uuid) to anon, authenticated;

drop function public.set_video_offset(uuid, text, integer);
create function public.set_video_offset(p_track_id uuid, p_video_id text, p_offset_ms integer, p_measured boolean default false)
returns void
language sql security invoker set search_path = ''
as $$
  insert into public.video_sync (track_id, video_id, offset_ms, measured) values (p_track_id, p_video_id, p_offset_ms, p_measured)
  on conflict (track_id, video_id, user_id) do update set offset_ms = excluded.offset_ms, measured = excluded.measured, updated_at = now()
$$;
revoke execute on function public.set_video_offset(uuid, text, integer, boolean) from public, anon;
grant execute on function public.set_video_offset(uuid, text, integer, boolean) to authenticated;
