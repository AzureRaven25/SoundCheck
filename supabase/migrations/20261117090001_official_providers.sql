-- YouTube search results are cached like other providers (the Data API quota is ~100 searches/day).
alter table private.provider_cache drop constraint provider_cache_provider_check;
alter table private.provider_cache add constraint provider_cache_provider_check
  check (provider in ('musicbrainz', 'coverartarchive', 'itunes', 'lrclib', 'spotify_oembed', 'youtube'));
