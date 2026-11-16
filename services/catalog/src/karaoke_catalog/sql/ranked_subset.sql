-- Fast, stepwise transform of the raw MusicBrainz staging tables (mb.*) into a ranked
-- song list for the SoundCheck cloud catalog. Replaces transform.sql's single huge
-- transaction (which spent >70 min sorting): every step is a hash aggregate over an
-- UNLOGGED table and commits on its own, so a failure only repeats one step.
--
-- Eligibility rules are the same as transform.sql (official Album/Single/EP, no live/remix/
-- demo/etc. release groups, no videos, no live/instrumental/karaoke/demo recordings).
\timing on
set work_mem = '1GB';
set max_parallel_workers_per_gather = 6;

-- 1. eligible releases, with a sortable first-release date
drop table if exists mb.x_release;
create unlogged table mb.x_release as
select r.id as release, rg.id as release_group, rg.artist_credit as rg_artist_credit,
       coalesce(d.sort_date, 99999999) as sort_date
from mb.release r
join mb.release_group rg on rg.id = r.release_group
join mb.release_status s on s.id = r.status and s.name = 'Official'
join mb.release_group_primary_type pt on pt.id = rg.type and pt.name in ('Album', 'Single', 'EP')
left join (
  select release, min(date_year * 10000 + coalesce(date_month, 0) * 100 + coalesce(date_day, 0)) as sort_date
  from (select release, date_year, date_month, date_day from mb.release_country
        union all select release, date_year, date_month, date_day from mb.release_unknown_country) x
  where date_year is not null group by release
) d on d.release = r.id
where not exists (
  select 1 from mb.release_group_secondary_type_join j
  join mb.release_group_secondary_type st on st.id = j.secondary_type
  where j.release_group = rg.id
    and st.name in ('Live', 'Remix', 'DJ-mix', 'Interview', 'Spokenword', 'Audiobook', 'Audio drama', 'Demo', 'Field recording')
);
alter table mb.x_release add primary key (release);
analyze mb.x_release;

-- 2. per-recording popularity + earliest (date, release group), packed into one bigint so a plain
--    min() replaces an ordered array_agg (date * 1e8 + release_group id; ids < 1e8).
--    Popularity counts DISTINCT release groups, and groups credited to other artists (compilations,
--    soundtracks, "Various Artists") weigh 3x: a hit gets anthologised by others, while an artist
--    re-releasing their own track hundreds of times (spam/noise projects) gains almost nothing.
drop table if exists mb.x_rec_groups;
create unlogged table mb.x_rec_groups as
select t.recording, xr.release_group, bool_or(xr.rg_artist_credit <> t.artist_credit) as other_artist,
       min(xr.sort_date) as sort_date
from mb.track t
join mb.medium m on m.id = t.medium
join mb.x_release xr on xr.release = m.release
where not t.is_data_track
group by t.recording, xr.release_group;

drop table if exists mb.x_rec_stats;
create unlogged table mb.x_rec_stats as
select recording,
       (3 * count(*) filter (where other_artist) + least(count(*) filter (where not other_artist), 5))::int as appearances,
       min(sort_date::bigint * 100000000 + release_group) as first_key
from mb.x_rec_groups
group by recording;
analyze mb.x_rec_stats;

-- 3. recordings with vocals, normalised title
drop table if exists mb.x_recording;
create unlogged table mb.x_recording as
select rec.id, rec.gid, rec.name, rec.artist_credit, rec.length,
       catalog.norm(rec.name) as norm_title,
       s.appearances, s.first_key
from mb.recording rec
join mb.x_rec_stats s on s.recording = rec.id
join mb.artist_credit ac on ac.id = rec.artist_credit
where not rec.video
  and rec.name !~ '^\s*\[.*\]\s*$'                         -- [silence], [untitled], [data track], [unknown]
  and ac.name !~ '^\['                                        -- [no artist], [unknown], [anonymous], [traditional]
  and ac.name not in ('Various Artists', 'Anonymous', 'Unknown Artist')
  and coalesce(rec.comment, '') !~* '\m(live|instrumental|karaoke|demo|a cappella|acapella)\M'
  and rec.name !~* '[(\[][^)\]]*\m(live|instrumental|karaoke|demo)\M[^)\]]*[)\]]';
analyze mb.x_recording;

-- 4. one song per (artist credit, normalised title). The representative recording has the most
--    appearances (ties: earliest, then lowest id), again packed into a single max() key.
drop table if exists mb.x_song;
create unlogged table mb.x_song as
select artist_credit, norm_title,
       (max(appearances::numeric * 1e16 + (99999999 - first_key / 100000000)::numeric * 1e8 + (99999999 - id)::numeric)
         % 1e8) as rep_key,
       sum(appearances)::int as popularity,
       min(first_key) as first_key,
       count(*)::int as recordings
from mb.x_recording
group by artist_credit, norm_title;
alter table mb.x_song add column rep_id int;
update mb.x_song set rep_id = 99999999 - rep_key::int;
analyze mb.x_song;

-- 5. the ranked list (rank 1 = most-released song)
drop table if exists mb.x_ranked;
create unlogged table mb.x_ranked as
select row_number() over (order by s.popularity desc, s.rep_id) as rank,
       s.rep_id, s.artist_credit, s.norm_title, s.popularity, s.recordings,
       nullif(s.first_key / 100000000, 99999999) as first_date,
       (s.first_key % 100000000)::int as first_release_group
from mb.x_song s;
alter table mb.x_ranked add primary key (rank);
create index on mb.x_ranked (rep_id);
analyze mb.x_ranked;

select count(*) as songs, max(popularity) as max_pop,
       count(*) filter (where popularity >= 5) as pop_ge_5,
       count(*) filter (where popularity >= 10) as pop_ge_10
from mb.x_ranked;
