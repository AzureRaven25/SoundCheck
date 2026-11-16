-- KaraokeApp song catalog.
--
-- `song` is one row per distinct song (artist credit + normalised title), built
-- from MusicBrainz recordings that appear on official studio releases. Remasters
-- and compilation appearances of the same recording collapse into one song.
-- `library_item` records which songs we can actually sing (processed bundles).

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS catalog;

-- unaccent() is only STABLE; wrap it so it can be used in indexes and generated columns.
CREATE OR REPLACE FUNCTION catalog.immutable_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Normalisation used for grouping and for matching library files to songs.
CREATE OR REPLACE FUNCTION catalog.norm(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
    AS $$
    SELECT btrim(regexp_replace(
        lower(catalog.immutable_unaccent(translate($1, '’‘“”´`', $t$''""''$t$))),
        '\s+', ' ', 'g'))
    $$;

CREATE TABLE IF NOT EXISTS catalog.import_run (
    id            serial PRIMARY KEY,
    source        text NOT NULL,           -- e.g. 'musicbrainz:20261114-002230'
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    songs         bigint,
    artists       bigint
);

CREATE TABLE IF NOT EXISTS catalog.artist (
    id         integer PRIMARY KEY,        -- MusicBrainz artist row id
    mbid       uuid NOT NULL UNIQUE,
    name       text NOT NULL,
    sort_name  text NOT NULL,
    comment    text                        -- MusicBrainz disambiguation
);

CREATE TABLE IF NOT EXISTS catalog.song (
    id                  bigint PRIMARY KEY,  -- = MusicBrainz id of the representative recording
    title               text NOT NULL,
    artist_name         text NOT NULL,       -- display credit, e.g. "Queen & David Bowie"
    artist_credit_id    integer NOT NULL,
    norm_title          text NOT NULL,
    norm_artist         text NOT NULL,
    recording_mbid      uuid NOT NULL,       -- representative recording
    release_group_mbid  uuid,                -- earliest eligible release group (for cover art)
    length_ms           integer,
    first_release_date  integer,             -- yyyymmdd, unknown parts = 00
    release_count       integer NOT NULL,    -- eligible releases featuring it (rough popularity)
    search              tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', catalog.immutable_unaccent(title)), 'A') ||
        setweight(to_tsvector('simple', catalog.immutable_unaccent(artist_name)), 'B')
    ) STORED
);

CREATE TABLE IF NOT EXISTS catalog.song_artist (
    song_id    bigint NOT NULL REFERENCES catalog.song(id) ON DELETE CASCADE,
    position   smallint NOT NULL,
    artist_id  integer NOT NULL REFERENCES catalog.artist(id),
    PRIMARY KEY (song_id, position)
);

-- Every recording MBID that maps to a song. Files tagged by MusicBrainz Picard
-- carry the recording MBID, which gives an exact match.
CREATE TABLE IF NOT EXISTS catalog.song_recording (
    recording_mbid  uuid PRIMARY KEY,
    song_id         bigint NOT NULL REFERENCES catalog.song(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS catalog.song_isrc (
    isrc     text NOT NULL,
    song_id  bigint NOT NULL REFERENCES catalog.song(id) ON DELETE CASCADE,
    PRIMARY KEY (isrc, song_id)
);

-- Processed song bundles from services/pipeline. song_id is NULL when a bundle
-- couldn't be matched to the catalog (it's still singable). No foreign key on
-- purpose: a catalog re-import replaces every song row, then re-links bundles.
CREATE TABLE IF NOT EXISTS catalog.library_item (
    bundle_id      text PRIMARY KEY,
    song_id        bigint,
    title          text NOT NULL,
    artist         text,
    duration_s     real,
    has_lyrics     boolean NOT NULL DEFAULT false,
    bundle_path    text NOT NULL,
    match_method   text,                   -- recording_mbid | isrc | exact | fuzzy
    match_score    real,
    linked_at      timestamptz NOT NULL DEFAULT now()
);

-- Keyed by recording MBID (stable across imports), not by song id.
CREATE TABLE IF NOT EXISTS catalog.wishlist (
    recording_mbid  uuid PRIMARY KEY,
    added_at        timestamptz NOT NULL DEFAULT now()
);
