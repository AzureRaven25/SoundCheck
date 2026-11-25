-- Sing along to YouTube: how far each video's audio is from the song's synced-lyrics clock.
-- A music video can have an intro, a karaoke video a title card; singers nudge the lyrics until they match and the
-- correction is shared (median of everyone's), so the next singer gets lyrics in time from the first line.
create table public.video_sync (
  track_id   uuid not null references public.tracks (id) on delete cascade,
  video_id   text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  offset_ms  integer not null check (offset_ms between -300000 and 300000),  -- video time = lyrics time + offset
  updated_at timestamptz not null default now(),
  primary key (track_id, video_id, user_id)
);
alter table public.video_sync enable row level security;
create policy "read own video sync" on public.video_sync for select to authenticated using (user_id = (select auth.uid()));
create policy "add own video sync" on public.video_sync for insert to authenticated with check (user_id = (select auth.uid()));
create policy "change own video sync" on public.video_sync for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "remove own video sync" on public.video_sync for delete to authenticated using (user_id = (select auth.uid()));

-- Everyone's corrections for a song's videos, as one median per video (individual rows stay private).
create or replace function public.video_offsets(p_track_id uuid)
returns table (video_id text, offset_ms integer, votes integer)
language sql stable security definer set search_path = ''
as $$
  select v.video_id, (percentile_disc(0.5) within group (order by v.offset_ms))::integer, count(*)::integer
    from public.video_sync v where v.track_id = p_track_id group by v.video_id
$$;
grant execute on function public.video_offsets(uuid) to anon, authenticated;

-- Save (or replace) your correction for one video.
create or replace function public.set_video_offset(p_track_id uuid, p_video_id text, p_offset_ms integer)
returns void
language sql security invoker set search_path = ''
as $$
  insert into public.video_sync (track_id, video_id, offset_ms) values (p_track_id, p_video_id, p_offset_ms)
  on conflict (track_id, video_id, user_id) do update set offset_ms = excluded.offset_ms, updated_at = now()
$$;
revoke execute on function public.set_video_offset(uuid, text, integer) from public, anon;
grant execute on function public.set_video_offset(uuid, text, integer) to authenticated;
