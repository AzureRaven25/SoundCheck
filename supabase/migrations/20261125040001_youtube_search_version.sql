-- Re-search songs found with older search rules. query_version 2 = karaoke searches ask for "instrumental karaoke",
-- so official instrumentals (same master as the original) can be found. Older searches are redone by the crawl,
-- most popular first, after nothing else is pending for them; their earlier results stay and are re-ranked.
alter table private.youtube_searched add column query_version smallint not null default 1;

create or replace function public.youtube_mark_searched(p_track_id uuid, p_found integer)
returns void
language sql security definer set search_path = ''
as $$
  insert into private.youtube_searched (track_id, found, query_version) values (p_track_id, p_found, 2)
  on conflict (track_id) do update set searched_at = now(), found = excluded.found, query_version = 2
$$;

create or replace function public.youtube_crawl_candidates(p_limit integer)
returns table (id uuid, title text, artist_credit text, duration_ms integer)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.title, t.artist_credit, t.duration_ms from public.tracks t
   left join private.youtube_searched s on s.track_id = t.id
   where (s.track_id is null or s.query_version < 2)
     and not exists (select 1 from public.song_videos v where v.track_id = t.id and v.source = 'user' and s.track_id is null)
     and t.popularity > 0 and length(t.title) > 0 and t.artist_credit not ilike 'unknown%'
   order by (s.track_id is not null) desc, t.popularity desc, t.id   -- older searches first, then new songs
   limit least(greatest(p_limit, 1), 100)
$$;
