-- Built after a bulk load (much faster than maintaining them during inserts).
CREATE INDEX IF NOT EXISTS song_search_idx      ON catalog.song USING gin (search);
CREATE INDEX IF NOT EXISTS song_trgm_idx        ON catalog.song USING gin ((norm_title || ' ' || norm_artist) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS song_norm_idx        ON catalog.song (norm_title, norm_artist);
CREATE INDEX IF NOT EXISTS song_popularity_idx  ON catalog.song (release_count DESC);
CREATE INDEX IF NOT EXISTS song_artist_artist_idx ON catalog.song_artist (artist_id);
CREATE INDEX IF NOT EXISTS song_recording_song_idx ON catalog.song_recording (song_id);
CREATE INDEX IF NOT EXISTS song_isrc_song_idx   ON catalog.song_isrc (song_id);
CREATE INDEX IF NOT EXISTS artist_trgm_idx      ON catalog.artist USING gin (catalog.norm(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS library_item_song_idx ON catalog.library_item (song_id);
