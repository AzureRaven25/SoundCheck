-- Build catalog.* from the raw mb.* staging tables.
-- Runs inside one transaction, so a failed import leaves the old catalog intact.
-- Intermediate tables live in the mb schema (not TEMP) so Postgres can scan them
-- with parallel workers; the whole mb schema is dropped after the import.

-- 1. Releases worth counting: official albums/singles/EPs that aren't live,
--    remix, DJ-mix, spoken-word, demo, etc. Compilations and soundtracks stay.
CREATE UNLOGGED TABLE mb.eligible_release AS
SELECT r.id AS release, rg.id AS release_group, rg.gid AS rg_gid,
       COALESCE(d.sort_date, 99999999) AS sort_date
FROM mb.release r
JOIN mb.release_group rg ON rg.id = r.release_group
JOIN mb.release_status s ON s.id = r.status AND s.name = 'Official'
JOIN mb.release_group_primary_type pt ON pt.id = rg.type AND pt.name IN ('Album', 'Single', 'EP')
LEFT JOIN (
    SELECT release, min(date_year * 10000 + COALESCE(date_month, 0) * 100 + COALESCE(date_day, 0)) AS sort_date
    FROM (
        SELECT release, date_year, date_month, date_day FROM mb.release_country
        UNION ALL
        SELECT release, date_year, date_month, date_day FROM mb.release_unknown_country
    ) dates
    WHERE date_year IS NOT NULL
    GROUP BY release
) d ON d.release = r.id
WHERE NOT EXISTS (
    SELECT 1
    FROM mb.release_group_secondary_type_join j
    JOIN mb.release_group_secondary_type st ON st.id = j.secondary_type
    WHERE j.release_group = rg.id
      AND st.name IN ('Live', 'Remix', 'DJ-mix', 'Interview', 'Spokenword', 'Audiobook',
                      'Audio drama', 'Demo', 'Field recording')
);
CREATE INDEX ON mb.eligible_release (release);
ANALYZE mb.eligible_release;

-- 2. Recordings with vocals that appear on at least one eligible release.
CREATE UNLOGGED TABLE mb.eligible_recording AS
SELECT rec.id, rec.gid, rec.name, rec.artist_credit, rec.length,
       catalog.norm(rec.name) AS norm_title,
       count(DISTINCT er.release)::int AS release_count,
       min(er.sort_date) AS first_date,
       (array_agg(er.rg_gid ORDER BY er.sort_date, er.release))[1] AS first_rg_gid
FROM mb.recording rec
JOIN mb.track t ON t.recording = rec.id AND NOT t.is_data_track
JOIN mb.medium m ON m.id = t.medium
JOIN mb.eligible_release er ON er.release = m.release
WHERE NOT rec.video
  AND COALESCE(rec.comment, '') !~* '\m(live|instrumental|karaoke|demo|a cappella|acapella)\M'
  AND rec.name !~* '[(\[][^)\]]*\m(live|instrumental|karaoke|demo)\M[^)\]]*[)\]]'
GROUP BY rec.id, rec.gid, rec.name, rec.artist_credit, rec.length;

-- 3. One song per (artist credit, normalised title).
CREATE UNLOGGED TABLE mb.song_group AS
SELECT artist_credit, norm_title,
       (array_agg(id ORDER BY release_count DESC, first_date, id))[1] AS rep_id,
       sum(release_count)::int AS release_count,
       min(first_date) AS first_date,
       (array_agg(first_rg_gid ORDER BY first_date, id))[1] AS rg_gid,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY length) AS length_ms
FROM mb.eligible_recording
GROUP BY artist_credit, norm_title;

TRUNCATE catalog.song_artist, catalog.song_recording, catalog.song_isrc, catalog.song, catalog.artist;

INSERT INTO catalog.song (id, title, artist_name, artist_credit_id, norm_title, norm_artist,
                          recording_mbid, release_group_mbid, length_ms, first_release_date, release_count)
SELECT g.rep_id, rec.name, ac.name, g.artist_credit, g.norm_title, catalog.norm(ac.name),
       rec.gid, g.rg_gid, g.length_ms, NULLIF(g.first_date, 99999999), g.release_count
FROM mb.song_group g
JOIN mb.eligible_recording rec ON rec.id = g.rep_id
JOIN mb.artist_credit ac ON ac.id = g.artist_credit;

INSERT INTO catalog.song_recording (recording_mbid, song_id)
SELECT er.gid, g.rep_id
FROM mb.eligible_recording er
JOIN mb.song_group g ON g.artist_credit = er.artist_credit AND g.norm_title = er.norm_title;

INSERT INTO catalog.song_isrc (isrc, song_id)
SELECT DISTINCT i.isrc, g.rep_id
FROM mb.isrc i
JOIN mb.eligible_recording er ON er.id = i.recording
JOIN mb.song_group g ON g.artist_credit = er.artist_credit AND g.norm_title = er.norm_title;

INSERT INTO catalog.artist (id, mbid, name, sort_name, comment)
SELECT a.id, a.gid, a.name, a.sort_name, NULLIF(a.comment, '')
FROM mb.artist a
WHERE a.id IN (
    SELECT acn.artist FROM mb.artist_credit_name acn
    WHERE acn.artist_credit IN (SELECT DISTINCT artist_credit FROM mb.song_group)
);

INSERT INTO catalog.song_artist (song_id, position, artist_id)
SELECT s.id, acn.position, acn.artist
FROM catalog.song s
JOIN mb.artist_credit_name acn ON acn.artist_credit = s.artist_credit_id;
