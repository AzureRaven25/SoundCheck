-- query_version 3: when a song's searches find no official instrumental, one more search asks for one by name. An
-- official instrumental is the original recording minus the vocal, so it plays in exact step with the lyrics: karaoke
-- with nothing to line up. The crawl redoes older searches (most popular first) once nothing else is pending for
-- them; earlier results stay and are re-ranked.
create or replace function public.youtube_mark_searched(p_track_id uuid, p_found integer)
returns void
language sql security definer set search_path = ''
as $$
  insert into private.youtube_searched (track_id, found, query_version) values (p_track_id, p_found, 3)
  on conflict (track_id) do update set searched_at = now(), found = excluded.found, query_version = 3
$$;

create or replace function public.youtube_crawl_candidates(p_limit integer)
returns table (id uuid, title text, artist_credit text, duration_ms integer)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.title, t.artist_credit, t.duration_ms from public.tracks t
   left join private.youtube_searched s on s.track_id = t.id
   where (s.track_id is null or s.query_version < 3)
     and not exists (select 1 from public.song_videos v where v.track_id = t.id and v.source = 'user' and s.track_id is null)
     and t.popularity > 0 and length(t.title) > 0 and t.artist_credit not ilike 'unknown%'
   order by (s.track_id is not null) desc, t.popularity desc, t.id   -- older searches first, then new songs
   limit least(greatest(p_limit, 1), 100)
$$;

-- which search rules a song was last searched with (0: never); server-side only
create or replace function public.youtube_query_version(p_track_id uuid)
returns smallint
language sql stable security definer set search_path = ''
as $$ select coalesce((select query_version from private.youtube_searched where track_id = p_track_id), 0)::smallint $$;
revoke all on function public.youtube_query_version(uuid) from public, anon, authenticated;
grant execute on function public.youtube_query_version(uuid) to service_role;
