-- Openverse returned HTML-escaped titles/creators ("Pop &amp; Deep House"); the adapter decodes them now.
-- Fix rows imported before that, and drop cached search results that still hold escaped text.
create or replace function private.unescape_html(t text) returns text language sql immutable set search_path = ''
as $$ select replace(replace(replace(replace(replace(replace(t, '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&') $$;

update public.tracks t set title = private.unescape_html(t.title), artist_credit = private.unescape_html(t.artist_credit)
 where (t.title ~ '&(amp|quot|#39|apos|lt|gt);' or t.artist_credit ~ '&(amp|quot|#39|apos|lt|gt);')
   and exists (select 1 from public.track_sources s where s.track_id = t.id and s.provider in ('openverse', 'audius', 'ccmixter', 'jamendo'));
update public.albums a set title = private.unescape_html(a.title), artist_credit = private.unescape_html(a.artist_credit)
 where (a.title ~ '&(amp|quot|#39|apos|lt|gt);' or a.artist_credit ~ '&(amp|quot|#39|apos|lt|gt);')
   and exists (select 1 from public.tracks t join public.track_sources s on s.track_id = t.id
                where t.album_id = a.id and s.provider in ('openverse', 'audius', 'ccmixter', 'jamendo'));
update public.track_sources set attribution = private.unescape_html(attribution)
 where provider in ('openverse', 'audius', 'ccmixter', 'jamendo') and attribution ~ '&(amp|quot|#39|apos|lt|gt);';
delete from private.provider_cache where provider = 'acquire';
