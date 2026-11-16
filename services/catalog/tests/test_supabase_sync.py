import os

import pytest

from conftest import gid
from karaoke_catalog.db import read_sql
from karaoke_catalog.importer import load_staging
from karaoke_catalog.supabase_sync import SupabaseRest, build_rows, sync


def run_ranked_subset(conn):
    # strip psql meta-commands (\timing) so the script runs through psycopg
    sql = "\n".join(l for l in read_sql("ranked_subset.sql").splitlines() if not l.lstrip().startswith("\\"))
    conn.execute(sql)
    conn.commit()


@pytest.fixture()
def ranked(conn, fake_dump):
    load_staging(conn, fake_dump)
    run_ranked_subset(conn)
    return conn


def test_ranked_subset_applies_rules_and_ranks(ranked):
    rows = {r[1]: r for r in ranked.execute("select rank, rep_id, popularity, recordings from mb.x_ranked order by rank")}
    assert sorted(rows) == [101, 104, 108, 109]     # live/instrumental/bootleg/video excluded
    # Static Hearts (duet) appears on an album credited to someone else -> weighted 3x, ranks first
    assert rows[109][0] == 1 and rows[109][2] == 3
    # Aurora's Midnight Signal: album + her own compilation (own groups count 1 each); 2 recordings grouped,
    # the earliest (101) represents the song
    assert rows[101][2] == 2 and rows[101][3] == 2


def test_build_rows_uses_mbids_and_links_everything(ranked):
    rows = build_rows(ranked, 1, 100)
    tracks = {t["id"]: t for t in rows["tracks"]}
    assert set(tracks) == {gid(101), gid(104), gid(108), gid(109)}
    aurora = tracks[gid(101)]
    assert aurora["album_id"] == gid(500_000 + 501) and aurora["release_year"] == 2015 and aurora["popularity"] == 2
    assert tracks[gid(104)]["isrcs"] == ["USABC1800001"]
    assert {r["recording_mbid"] for r in rows["track_recordings"] if r["track_id"] == gid(101)} == {gid(101), gid(102)}
    duet = [a for a in rows["track_artists"] if a["track_id"] == gid(109)]
    assert [(a["position"], a["artist_id"]) for a in duet] == [(0, gid(1)), (1, gid(2))]
    assert all(a["id"] for a in rows["albums"]) and {a["primary_type"] for a in rows["albums"]} <= {"album", "single", "ep", "other"}
    track_album_ids = {t["album_id"] for t in rows["tracks"]} - {None}
    assert track_album_ids <= {a["id"] for a in rows["albums"]}


@pytest.mark.skipif(not os.environ.get("SUPABASE_TEST_URL"), reason="needs a local Supabase stack (SUPABASE_TEST_URL/KEY)")
def test_sync_upserts_into_supabase_idempotently(ranked):
    rest = SupabaseRest(os.environ["SUPABASE_TEST_URL"], os.environ["SUPABASE_TEST_KEY"])
    before = rest.count("tracks")
    sync(ranked, rest, 1, 100, log=lambda *_: None)
    after_first = rest.count("tracks")
    sync(ranked, rest, 1, 100, log=lambda *_: None)   # second run must not duplicate anything
    assert after_first - before <= 4 and rest.count("tracks") == after_first
    try:
        r = rest.client.post("/rpc/search_tracks", json={"q": "paper lantern"}).json()
        assert r and r[0]["title"] == "Paper Lanterns"
    finally:
        # leave the local stack as we found it (pgTAP tests count tracks); cascades to joins
        ids = ",".join(gid(n) for n in (101, 104, 108, 109))
        rest.client.delete("/tracks", params={"id": f"in.({ids})"})
        rest.client.delete("/artists", params={"id": f"in.({gid(1)},{gid(2)},{gid(3)})"})
        rest.client.delete("/albums", params={"id": f"in.({','.join(gid(500_000 + n) for n in range(501, 507))})"})
