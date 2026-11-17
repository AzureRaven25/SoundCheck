-- Artist pictures: Wikimedia Commons (via Wikidata, matched by MusicBrainz id) and Deezer as a fallback.
alter table public.artwork drop constraint artwork_provider_check;
alter table public.artwork add constraint artwork_provider_check
  check (provider in ('coverartarchive', 'itunes', 'spotify_oembed', 'cov_manual', 'upload', 'deezer', 'internet_archive', 'wikimedia'));
alter table public.artwork add column credit text;      -- e.g. the Commons file page, for attribution
alter table private.provider_cache drop constraint provider_cache_provider_check;
alter table private.provider_cache add constraint provider_cache_provider_check
  check (provider in ('musicbrainz', 'coverartarchive', 'itunes', 'lrclib', 'spotify_oembed', 'youtube', 'wikimedia', 'deezer'));
