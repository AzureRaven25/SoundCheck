-- SoundCheck M5 · Word-timed lyrics belong to the analysis of one upload, not to the track.
--
-- The worker aligns lyric lines against *that upload's* vocal stem. Storing the result as the track's
-- primary lyrics (as M4 did) let a single wrong or malicious upload corrupt word timing for every
-- user. Each analysis now carries its own word-timed copy; the shared `lyrics` rows stay untouched.

alter table public.karaoke_analysis add column word_lyrics jsonb
  check (word_lyrics is null or jsonb_typeof(word_lyrics -> 'lines') = 'array');
comment on column public.karaoke_analysis.word_lyrics is
  '{"lines":[{start,end,text,words:[{start,end,text}]}]}: lyric lines force-aligned to this upload''s vocal stem.';

-- Undo M4's shared copies: drop the aligned rows, then re-promote a provider version where a track
-- was left without a primary.
delete from public.lyrics where provider = 'aligned';
update public.lyrics l set is_primary = true
 where not exists (select 1 from public.lyrics p where p.track_id = l.track_id and p.is_primary)
   and l.id = (select x.id from public.lyrics x where x.track_id = l.track_id order by x.fetched_at limit 1);
