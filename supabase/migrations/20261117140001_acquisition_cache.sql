-- acquire: remember search results for a day so importing one doesn't ask the provider again
-- (keeps bulk imports inside Openverse's anonymous rate limit)
alter table private.provider_cache drop constraint provider_cache_provider_check;
alter table private.provider_cache add constraint provider_cache_provider_check
  check (provider in ('musicbrainz', 'coverartarchive', 'itunes', 'lrclib', 'spotify_oembed', 'youtube', 'wikimedia', 'deezer', 'acquire'));
