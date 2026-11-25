-- A song can be in a playlist only once. Existing duplicates are removed (the first-added copy is kept).
delete from public.playlist_tracks a
 using public.playlist_tracks b
 where a.playlist_id = b.playlist_id and a.track_id = b.track_id and a.id > b.id;
alter table public.playlist_tracks add constraint playlist_tracks_one_per_song unique (playlist_id, track_id);
