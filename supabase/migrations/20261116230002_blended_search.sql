-- SoundCheck M2 · Blended catalog search.
--
-- v1 only used trigram (typo) matching when full-text found nothing. With on-demand catalog growth
-- that fails badly: "bohemian rapsody" finds obscure songs literally titled "Bohemian Rapsody" and
-- never reaches Queen. Now every query scores both kinds of candidate as
--     score = match_quality × (1 + ln(1 + popularity))
-- where full-text hits (all words match, last as prefix) have quality 0.8–1.0 and typo matches
-- have quality similarity², so a famous near-match outranks an obscure exact one while exact
-- matches still win among comparable songs.

create or replace function public.search_tracks(q text, lim integer default 30, off integer default 0)
returns table (
  id uuid, title text, artist_credit text, album_id uuid, album_title text,
  duration_ms integer, release_year smallint, popularity integer, artwork_url text, rank real
)
language plpgsql
set search_path = ''
as $$
declare
  words text[];
  tsq   tsquery;
  nq    text;
  n     integer;
begin
  lim := least(greatest(coalesce(lim, 30), 1), 100);
  off := greatest(coalesce(off, 0), 0);
  words := array_remove(regexp_split_to_array(lower(private.unaccent_imm(coalesce(q, ''))), '[^[:alnum:]]+'), '');
  if coalesce(array_length(words, 1), 0) = 0 then
    return;
  end if;
  n := array_length(words, 1);
  if length(words[n]) >= 2 then
    words[n] := words[n] || ':*';
  end if;
  tsq := to_tsquery('simple', array_to_string(words, ' & '));
  nq := private.norm(q);
  perform set_config('pg_trgm.word_similarity_threshold', '0.45', true);

  return query
    with fulltext as (
      select t.id, (0.8 + 0.2 * least(1, ts_rank_cd(t.search, tsq) * 10)) * (1 + ln(1 + t.popularity)) as score
      from public.tracks t
      where t.search @@ tsq
      order by score desc
      limit 200
    ), fuzzy as (
      select t.id, power(extensions.word_similarity(nq, t.norm_title || ' ' || t.norm_artist), 2) * (1 + ln(1 + t.popularity)) as score
      from public.tracks t
      where nq operator(extensions.<%) (t.norm_title || ' ' || t.norm_artist)   -- tracks_trgm_idx
      order by score desc
      limit 200
    ), best as (
      select c.id, max(c.score) as score from (select * from fulltext union all select * from fuzzy) c group by c.id
    )
    select t.id, t.title, t.artist_credit, t.album_id, a.title, t.duration_ms, t.release_year, t.popularity,
           (select coalesce(aw.storage_path, aw.source_url) from public.artwork aw
             where aw.entity_type = 'album' and aw.entity_id = t.album_id and aw.is_primary and aw.status = 'ok' limit 1),
           b.score::real
    from best b
    join public.tracks t on t.id = b.id
    left join public.albums a on a.id = t.album_id
    order by b.score desc, t.id
    limit lim offset off;
end
$$;
comment on function public.search_tracks is 'Catalog search: full-text prefix + trigram typo candidates, ranked by match quality × popularity.';
grant execute on function public.search_tracks to anon, authenticated;
