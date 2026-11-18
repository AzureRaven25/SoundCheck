-- Word-timed lyrics from a shared (open-licensed) karaoke version, for songs without published lyrics.
create or replace function public.shared_word_lyrics(p_track_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select k.word_lyrics from public.karaoke_analysis k join public.audio_assets a on a.id = k.source_asset_id
   where k.track_id = p_track_id and a.owner_id is null and k.word_lyrics is not null
   order by k.created_at desc limit 1
$$;
grant execute on function public.shared_word_lyrics to anon, authenticated;
