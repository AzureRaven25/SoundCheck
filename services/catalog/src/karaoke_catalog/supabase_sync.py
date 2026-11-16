"""Sync the ranked MusicBrainz song list (local staging) into the SoundCheck Supabase catalog.

Local Postgres is only a staging area: it holds the raw dump tables (mb.*) and the ranked list
built by sql/ranked_subset.sql. This module reads the top-N songs from there and upserts them into
Supabase through the REST API with the server-side secret key. Ids are MusicBrainz ids
(tracks.id = representative recording MBID, albums.id = release-group MBID, artists.id = artist MBID),
the same scheme the catalog-search Edge Function uses, so bulk and on-demand rows never duplicate.

Environment: SUPABASE_URL, SUPABASE_SECRET_KEY (read from the repo's .env.local).
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import psycopg

REPO_ROOT = Path(__file__).resolve().parents[4]
PRIMARY_TYPES = {"Album": "album", "Single": "single", "EP": "ep"}


def load_env(path: Path = REPO_ROOT / ".env.local") -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


# Rank window [start, end): songs, their recordings, ISRCs, albums (first release group), credits.
SONGS_SQL = """
with picked as (
  select * from mb.x_ranked where rank >= %(start)s and rank < %(end)s
)
select p.rank, rec.gid::text as id, rec.name as title, ac.name as artist_credit, p.artist_credit as ac_id,
       nullif(rec.length, 0) as duration_ms, p.popularity,
       case when p.first_date is null then null else (p.first_date / 10000)::int end as release_year,
       rg.gid::text as album_id
from picked p
join mb.recording rec on rec.id = p.rep_id
join mb.artist_credit ac on ac.id = p.artist_credit
left join mb.release_group rg on rg.id = p.first_release_group
order by p.rank
"""

# Up to MAX_RECORDINGS recording MBIDs per song (most-released first, representative always included):
# enough for exact matching of tagged uploads. Hits have ~20 recordings each; the full mapping is
# the long-tail tier's job (Turso), keeping Supabase inside its storage budget.
MAX_RECORDINGS = 5
RECORDINGS_SQL = """
with picked as (select * from mb.x_ranked where rank >= %(start)s and rank < %(end)s),
recs as (
  select xr.id, xr.gid, p.rep_id,
         row_number() over (partition by p.rep_id order by (xr.id = p.rep_id) desc, xr.appearances desc, xr.id) as n
  from picked p
  join mb.x_recording xr on xr.artist_credit = p.artist_credit and xr.norm_title = p.norm_title
)
select r.gid::text as recording_mbid, r.rep_id,
       coalesce(array_agg(distinct i.isrc) filter (where i.isrc is not null), '{}') as isrcs
from recs r
left join mb.isrc i on i.recording = r.id
where r.n <= %(max_recordings)s
group by r.gid, r.rep_id
"""

ALBUMS_SQL = """
select rg.gid::text as id, rg.name as title, ac.name as artist_credit, rg.artist_credit as ac_id, pt.name as primary_type,
       (select min(xr.sort_date) / 10000 from mb.x_release xr where xr.release_group = rg.id and xr.sort_date < 99999999) as release_year
from mb.release_group rg
join mb.artist_credit ac on ac.id = rg.artist_credit
left join mb.release_group_primary_type pt on pt.id = rg.type
where rg.id = any(%(ids)s)
"""

CREDITS_SQL = """
select acn.artist_credit as ac_id, acn.position, acn.join_phrase, a.gid::text as artist_id, a.name, a.sort_name,
       nullif(a.comment, '') as disambiguation
from mb.artist_credit_name acn join mb.artist a on a.id = acn.artist
where acn.artist_credit = any(%(ids)s)
"""


class SupabaseRest:
    def __init__(self, url: str, key: str):
        self.client = httpx.Client(
            base_url=f"{url.rstrip('/')}/rest/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=120,
        )

    def upsert(self, table: str, rows: list[dict], on_conflict: str, merge: bool = True, batch: int = 1000) -> None:
        prefer = "resolution=merge-duplicates" if merge else "resolution=ignore-duplicates"
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            for attempt in range(4):
                r = self.client.post(f"/{table}", params={"on_conflict": on_conflict}, json=chunk,
                                     headers={"Prefer": f"{prefer},return=minimal"})
                if r.status_code < 300:
                    break
                if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"{table} upsert failed ({r.status_code}): {r.text[:500]}")

    def count(self, table: str) -> int:
        r = self.client.head(f"/{table}", params={"select": "*"}, headers={"Prefer": "count=exact", "Range": "0-0"})
        return int(r.headers.get("content-range", "*/0").split("/")[-1])


def windows(start: int, end: int, size: int) -> Iterator[tuple[int, int]]:
    for s in range(start, end, size):
        yield s, min(end, s + size)


def build_rows(conn: psycopg.Connection, start: int, end: int) -> dict[str, list[dict]]:
    params = {"start": start, "end": end}
    songs = conn.execute(SONGS_SQL, params).fetchall()
    cols = ["rank", "id", "title", "artist_credit", "ac_id", "duration_ms", "popularity", "release_year", "album_id"]
    songs = [dict(zip(cols, r)) for r in songs]

    rep_to_track: dict[int, str] = {}
    rep_rows = conn.execute("select rep_id, rank from mb.x_ranked where rank >= %(start)s and rank < %(end)s", params).fetchall()
    rank_to_id = {s["rank"]: s["id"] for s in songs}
    for rep_id, rank in rep_rows:
        if rank in rank_to_id:
            rep_to_track[rep_id] = rank_to_id[rank]

    track_recordings, isrcs_by_track = [], {}
    for recording_mbid, rep_id, isrcs in conn.execute(RECORDINGS_SQL, {**params, "max_recordings": MAX_RECORDINGS}).fetchall():
        track_id = rep_to_track.get(rep_id)
        if not track_id:
            continue
        track_recordings.append({"recording_mbid": recording_mbid, "track_id": track_id})
        isrcs_by_track.setdefault(track_id, set()).update(isrcs)

    rg_ids = conn.execute(
        "select distinct first_release_group from mb.x_ranked where rank >= %(start)s and rank < %(end)s and first_release_group > 0",
        params).fetchall()
    albums = []
    for id_, title, credit, ac_id, ptype, year in conn.execute(ALBUMS_SQL, {"ids": [r[0] for r in rg_ids]}).fetchall():
        albums.append({"id": id_, "mbid": id_, "title": title[:500], "artist_credit": credit,
                       "primary_type": PRIMARY_TYPES.get(ptype or "", "other"),
                       "release_year": int(year) if year and 1800 <= year <= 2200 else None, "_ac": ac_id})

    ac_ids = list({s["ac_id"] for s in songs} | {a["_ac"] for a in albums})
    credits: dict[int, list[tuple]] = {}
    artists: dict[str, dict] = {}
    for ac_id, pos, join, artist_id, name, sort_name, disamb in conn.execute(CREDITS_SQL, {"ids": ac_ids}).fetchall():
        credits.setdefault(ac_id, []).append((pos, artist_id, join or ""))
        artists[artist_id] = {"id": artist_id, "mbid": artist_id, "name": name[:500], "sort_name": sort_name, "disambiguation": disamb}

    album_ids = {a["id"] for a in albums}
    tracks, track_artists = [], []
    for s in songs:
        tracks.append({
            "id": s["id"], "mbid": s["id"], "title": s["title"][:500], "artist_credit": s["artist_credit"],
            "album_id": s["album_id"] if s["album_id"] in album_ids else None,
            "duration_ms": s["duration_ms"], "popularity": s["popularity"],
            "release_year": s["release_year"] if s["release_year"] and 1800 <= s["release_year"] <= 2200 else None,
            "isrcs": sorted(isrcs_by_track.get(s["id"], set()))[:20],
        })
        for pos, artist_id, join in credits.get(s["ac_id"], []):
            track_artists.append({"track_id": s["id"], "position": pos, "artist_id": artist_id, "join_phrase": join})
    album_artists = [
        {"album_id": a["id"], "position": pos, "artist_id": artist_id, "join_phrase": join}
        for a in albums for pos, artist_id, join in credits.get(a["_ac"], [])
    ]
    for a in albums:
        del a["_ac"]
    return {
        "artists": list(artists.values()), "albums": albums, "album_artists": album_artists,
        "tracks": tracks, "track_artists": track_artists, "track_recordings": track_recordings,
    }


def sync(conn: psycopg.Connection, rest: SupabaseRest, start: int, end: int, window: int = 5000,
         log=print) -> dict[str, int]:
    totals: dict[str, int] = {}
    order = [("artists", "id"), ("albums", "id"), ("album_artists", "album_id,position"),
             ("tracks", "id"), ("track_artists", "track_id,position"), ("track_recordings", "recording_mbid")]
    for s, e in windows(start, end, window):
        t0 = time.perf_counter()
        rows = build_rows(conn, s, e)
        for table, conflict in order:
            # Recordings can collide with on-demand rows (same recording, other song id): keep the existing mapping.
            rest.upsert(table, rows[table], conflict, merge=table not in ("track_recordings",))
            totals[table] = totals.get(table, 0) + len(rows[table])
        log(f"  ranks {s:,}-{e - 1:,}: {len(rows['tracks']):,} tracks, {len(rows['albums']):,} albums, "
            f"{len(rows['artists']):,} artists ({time.perf_counter() - t0:.0f}s)")
    return totals
