-- Community-synced lyrics: when a song has only plain lyrics (or none), a singer can tap along to the original
-- recording to time each line. A submission becomes the song's lyrics only when nothing synced exists yet, so it
-- fills gaps and never replaces published synced lyrics. Every submission is kept with who sent it.
create table public.lyrics_submissions (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid not null references public.tracks (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  video_id    text check (video_id ~ '^[A-Za-z0-9_-]{11}$'),       -- the recording they synced against
  content     jsonb not null check (jsonb_typeof(content -> 'lines') = 'array'),
  status      text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  created_at  timestamptz not null default now()
);
create index lyrics_submissions_track_idx on public.lyrics_submissions (track_id, created_at desc);
create index lyrics_submissions_user_idx on public.lyrics_submissions (user_id, created_at desc);
alter table public.lyrics_submissions enable row level security;
create policy "see own lyrics submissions" on public.lyrics_submissions for select to authenticated using (user_id = (select auth.uid()));
-- inserts go through submit_synced_lyrics (validation + rate limit); no direct insert policy

create or replace function public.submit_synced_lyrics(p_track_id uuid, p_lines jsonb, p_video_id text default null)
returns text   -- 'applied' (now the song's lyrics) or 'pending' (kept; synced lyrics already exist)
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n int;
  prev numeric := -1;
  line jsonb;
  clean jsonb := '[]'::jsonb;
  t numeric;
  txt text;
  cur record;
  outcome text;
begin
  if uid is null then raise exception 'sign in required'; end if;
  if (select count(*) from public.lyrics_submissions where user_id = uid and created_at > now() - interval '1 day') >= 30 then
    raise exception 'too many lyrics submissions today';
  end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'lines must be an array'; end if;
  n := jsonb_array_length(p_lines);
  if n < 3 or n > 400 then raise exception 'between 3 and 400 lines'; end if;
  for line in select * from jsonb_array_elements(p_lines) loop
    txt := left(btrim(coalesce(line ->> 'text', '')), 300);
    if txt = '' then continue; end if;
    t := (line ->> 'start')::numeric;
    if t is null or t < 0 or t > 3600 or t < prev then raise exception 'line times must increase'; end if;
    prev := t;
    clean := clean || jsonb_build_object('start', round(t, 2), 'text', txt);
  end loop;
  if jsonb_array_length(clean) < 3 then raise exception 'not enough lyrics'; end if;

  select granularity, provider into cur from public.lyrics where track_id = p_track_id and is_primary;
  if cur is null or cur.granularity = 'plain' then
    update public.lyrics set is_primary = false where track_id = p_track_id and is_primary;
    insert into public.lyrics (track_id, provider, provider_ref, granularity, content, is_primary)
      values (p_track_id, 'manual', uid::text, 'line', jsonb_build_object('lines', clean), true)
      on conflict (track_id, provider) do update
        set provider_ref = excluded.provider_ref, granularity = 'line', content = excluded.content, is_primary = true, fetched_at = now();
    outcome := 'applied';
  else
    outcome := 'pending';
  end if;
  insert into public.lyrics_submissions (track_id, user_id, video_id, content, status)
    values (p_track_id, uid, p_video_id, jsonb_build_object('lines', clean), outcome);
  return outcome;
end;
$$;
revoke execute on function public.submit_synced_lyrics(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_synced_lyrics(uuid, jsonb, text) to authenticated;
