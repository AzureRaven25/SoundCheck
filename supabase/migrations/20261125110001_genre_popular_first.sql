-- Genre pages lead with songs people know (popular catalog songs, which can be sung along to on YouTube), then the
-- full-length open-licensed recordings. Counts include both.
create or replace function public.genre_tracks(p_genre text, p_limit integer default 60, p_offset integer default 0)
returns table (track_id uuid)
language sql stable security definer set search_path = ''
as $$
  select t.id from public.tracks t
   where t.genres @> array[p_genre]
     and (t.popularity > 0 or exists (select 1 from public.track_sources s where s.track_id = t.id and s.stream_url is not null))
   order by t.popularity desc, t.created_at desc, t.id
   limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
$$;

create or replace function public.genre_counts()
returns table (genre text, songs bigint)
language sql stable security definer set search_path = ''
as $$
  select g, count(*) from public.tracks t, unnest(t.genres) g
   where t.popularity > 0 or exists (select 1 from public.track_sources s where s.track_id = t.id and s.stream_url is not null)
   group by g order by count(*) desc
$$;
