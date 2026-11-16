-- Raw MusicBrainz tables, column-for-column in dump order (admin/sql/CreateTables.sql).
-- UNLOGGED: they're scratch space for one import and are dropped afterwards.
DROP SCHEMA IF EXISTS mb CASCADE;
CREATE SCHEMA mb;

CREATE UNLOGGED TABLE mb.artist (
    id int, gid uuid, name text, sort_name text,
    begin_date_year smallint, begin_date_month smallint, begin_date_day smallint,
    end_date_year smallint, end_date_month smallint, end_date_day smallint,
    type int, area int, gender int, comment text, edits_pending int,
    last_updated timestamptz, ended boolean, begin_area int, end_area int
);
CREATE UNLOGGED TABLE mb.artist_credit (
    id int, name text, artist_count smallint, ref_count int, created timestamptz, edits_pending int, gid uuid
);
CREATE UNLOGGED TABLE mb.artist_credit_name (
    artist_credit int, position smallint, artist int, name text, join_phrase text
);
CREATE UNLOGGED TABLE mb.recording (
    id int, gid uuid, name text, artist_credit int, length int, comment text,
    edits_pending int, last_updated timestamptz, video boolean
);
CREATE UNLOGGED TABLE mb.isrc (
    id int, recording int, isrc text, edits_pending int, created timestamptz
);
CREATE UNLOGGED TABLE mb.track (
    id int, gid uuid, recording int, medium int, position int, number text, name text,
    artist_credit int, length int, edits_pending int, last_updated timestamptz, is_data_track boolean
);
CREATE UNLOGGED TABLE mb.medium (
    id int, release int, position int, format int, name text, edits_pending int,
    last_updated timestamptz, track_count int, gid uuid
);
CREATE UNLOGGED TABLE mb.release (
    id int, gid uuid, name text, artist_credit int, release_group int, status int,
    packaging int, language int, script int, barcode text, comment text,
    edits_pending int, quality smallint, last_updated timestamptz
);
CREATE UNLOGGED TABLE mb.release_group (
    id int, gid uuid, name text, artist_credit int, type int, comment text,
    edits_pending int, last_updated timestamptz
);
CREATE UNLOGGED TABLE mb.release_status (
    id int, name text, parent int, child_order int, description text, gid uuid
);
CREATE UNLOGGED TABLE mb.release_group_primary_type (
    id int, name text, parent int, child_order int, description text, gid uuid
);
CREATE UNLOGGED TABLE mb.release_group_secondary_type (
    id int, name text, parent int, child_order int, description text, gid uuid
);
CREATE UNLOGGED TABLE mb.release_group_secondary_type_join (
    release_group int, secondary_type int, created timestamptz
);
CREATE UNLOGGED TABLE mb.release_country (
    release int, country int, date_year smallint, date_month smallint, date_day smallint
);
CREATE UNLOGGED TABLE mb.release_unknown_country (
    release int, date_year smallint, date_month smallint, date_day smallint
);
