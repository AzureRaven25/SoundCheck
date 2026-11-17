"""Bulk album artwork from the Cover Art Archive data dump (no per-album API calls).

The CAA dump (mbdump-cover-art-archive.tar.bz2) lists every uploaded image with its release and type.
For each album (MusicBrainz release group) in the Supabase catalog we pick:
  1. the release the community chose for the group (release_group_cover_art), else
  2. the earliest eligible release in the group that has a Front image,
and its Front image with the lowest ordering. The stored URL is the direct CAA thumbnail
`https://coverartarchive.org/release/<release mbid>/<image id>-500.jpg`: one redirect to archive.org
instead of the API's lookup + redirects, and no rate-limit cost. Clients may request `-1200.jpg` for
big screens and fall back to `-500.jpg`.
"""

from __future__ import annotations

import subprocess
import time
from pathlib import Path

import psycopg

from .supabase_sync import SupabaseRest

STAGING = """
drop table if exists mb.caa_cover_art, mb.caa_cover_art_type, mb.caa_rg_cover_art;
create unlogged table mb.caa_cover_art (
  id bigint, release int, comment text, edit int, ordering int, date_uploaded timestamptz, edits_pending int,
  mime_type text, filesize int, thumb_250_filesize int, thumb_500_filesize int, thumb_1200_filesize int
);
create unlogged table mb.caa_cover_art_type (id bigint, type_id int);
create unlogged table mb.caa_rg_cover_art (release_group int, release int);
"""
FILES = {
    "caa_cover_art": "cover_art_archive.cover_art",
    "caa_cover_art_type": "cover_art_archive.cover_art_type",
    "caa_rg_cover_art": "cover_art_archive.release_group_cover_art",
}

# Front image per release group, for the albums synced to Supabase (ranks < max_rank).
PICK_SQL = """
with albums as (
  select distinct first_release_group as rg from mb.x_ranked where rank < %(max_rank)s and first_release_group > 0
),
fronts as (                       -- front images with their release and that release's group
  select ca.id as image_id, ca.release, ca.ordering, r.release_group as rg, r.gid as release_gid
  from mb.caa_cover_art ca
  join mb.caa_cover_art_type t on t.id = ca.id and t.type_id = 1      -- 1 = Front
  join mb.release r on r.id = ca.release
  where r.release_group in (select rg from albums)
),
ranked as (
  select f.*, row_number() over (
           partition by f.rg
           order by (chosen.release is not null) desc,                 -- community-chosen release first
                    coalesce(xr.sort_date, 99999999),                  -- then the earliest eligible release
                    f.ordering, f.image_id
         ) as n
  from fronts f
  left join mb.caa_rg_cover_art chosen on chosen.release_group = f.rg and chosen.release = f.release
  left join mb.x_release xr on xr.release = f.release
)
select rg.gid::text as album_id,
       'https://coverartarchive.org/release/' || ranked.release_gid || '/' || ranked.image_id || '-500.jpg' as url
from ranked join mb.release_group rg on rg.id = ranked.rg
where ranked.n = 1
"""


def load_staging(conn: psycopg.Connection, archive: Path, workdir: Path) -> None:
    workdir.mkdir(parents=True, exist_ok=True)
    if not (workdir / "mbdump" / FILES["caa_cover_art"]).exists():
        subprocess.run(["tar", "-xjf", str(archive), "-C", str(workdir)], check=True)
    conn.execute(STAGING)
    for table, fname in FILES.items():
        with conn.cursor() as cur, (workdir / "mbdump" / fname).open("rb") as f:
            with cur.copy(f"COPY mb.{table} FROM STDIN") as copy:
                while chunk := f.read(1 << 20):
                    copy.write(chunk)
    conn.execute("create index on mb.caa_cover_art_type (id); create index on mb.caa_cover_art (release);"
                 "create index on mb.caa_rg_cover_art (release_group, release); analyze mb.caa_cover_art; analyze mb.caa_cover_art_type")
    conn.commit()


def existing_album_artwork(rest: SupabaseRest) -> set[str]:
    have: set[str] = set()
    offset = 0
    while True:
        r = rest.client.get("/artwork", params={"select": "entity_id", "entity_type": "eq.album", "is_primary": "eq.true",
                                                "offset": offset, "limit": 1000})
        rows = r.json()
        have.update(x["entity_id"] for x in rows)
        if len(rows) < 1000:
            return have
        offset += 1000


def backfill(conn: psycopg.Connection, rest: SupabaseRest, max_rank: int, log=print) -> int:
    t0 = time.perf_counter()
    picks = conn.execute(PICK_SQL, {"max_rank": max_rank}).fetchall()
    log(f"  {len(picks):,} albums have a Cover Art Archive front image ({time.perf_counter() - t0:.0f}s)")
    have = existing_album_artwork(rest)
    rows = [{"entity_type": "album", "entity_id": album_id, "provider": "coverartarchive", "source_url": url,
             "is_primary": True, "status": "ok"} for album_id, url in picks if album_id not in have]
    # Albums not yet in Supabase would violate nothing (artwork has no FK) but are pointless: keep to synced ones.
    synced: set[str] = set()
    ids = [r["entity_id"] for r in rows]
    for i in range(0, len(ids), 80):  # keep URLs short: some gateways reject >~4 KB request lines
        chunk = ids[i:i + 80]
        r = rest.client.get("/albums", params={"select": "id", "id": f"in.({','.join(chunk)})"})
        r.raise_for_status()
        synced.update(x["id"] for x in r.json())
    rows = [r for r in rows if r["entity_id"] in synced]
    rest.upsert("artwork", rows, "entity_type,entity_id,provider,source_url", merge=False)
    log(f"  registered artwork for {len(rows):,} albums (skipped {len(have):,} that already had one)")
    return len(rows)
