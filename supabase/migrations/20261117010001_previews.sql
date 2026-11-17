-- SoundCheck M3 · Preview playback support.
-- 30-second store previews (iTunes Search API) make the catalog playable before any user upload.
-- Apple's terms expect previews to link back to the store: attribution_url holds that link.

alter table public.audio_assets add column attribution_url text;
comment on column public.audio_assets.attribution_url is 'Store/provider page to credit (required for itunes_preview assets).';
alter table public.audio_assets add constraint audio_assets_preview_attribution
  check (provider <> 'itunes_preview' or attribution_url is not null);

-- At most one shared preview per track.
create unique index audio_assets_one_preview_idx on public.audio_assets (track_id) where kind = 'preview' and owner_id is null;

-- Album track listings and artist pages order by popularity within the album/artist.
create index if not exists tracks_album_popularity_idx on public.tracks (album_id, popularity desc);
