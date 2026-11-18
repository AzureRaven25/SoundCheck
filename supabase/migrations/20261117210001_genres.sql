-- Genres for discovery (/genre/<slug>): canonical slugs mapped from each source's own tags.
alter table public.tracks add column genres text[] not null default '{}';
create index tracks_genres_idx on public.tracks using gin (genres);

-- Songs in a genre that play in full for everyone, newest additions first.
create or replace function public.genre_tracks(p_genre text, p_limit integer default 60, p_offset integer default 0)
returns table (track_id uuid)
language sql stable security definer set search_path = ''
as $$
  select t.id from public.tracks t
   where t.genres @> array[p_genre]
     and exists (select 1 from public.track_sources s where s.track_id = t.id and s.stream_url is not null)
   order by t.created_at desc
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
$$;
grant execute on function public.genre_tracks to anon, authenticated;

-- How many full-length songs each genre has (for the genre index).
create or replace function public.genre_counts()
returns table (genre text, songs bigint)
language sql stable security definer set search_path = ''
as $$
  select g, count(*) from public.tracks t, unnest(t.genres) g
   where exists (select 1 from public.track_sources s where s.track_id = t.id and s.stream_url is not null)
   group by g order by count(*) desc
$$;
grant execute on function public.genre_counts to anon, authenticated;
