"""Test fixtures: a throwaway Postgres database and a tiny fake MusicBrainz dump.

Needs a local Postgres (brew services start postgresql@17). The test database is
$KARAOKE_TEST_DATABASE_URL, default postgresql:///karaoke_test.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest

from karaoke_catalog import db

TEST_DSN = os.environ.get("KARAOKE_TEST_DATABASE_URL", "postgresql:///karaoke_test")
TS = "2024-01-01 00:00:00+00"
N = r"\N"


def gid(n: int) -> str:
    return str(uuid.UUID(int=n))


# Fictional artists/songs. Expected outcome is documented next to each recording.
ARTISTS = [(1, "Aurora Vale"), (2, "The Night Owls"), (3, "Zoë Marlowe")]
ARTIST_CREDITS = [  # id, name, [artist ids]
    (1, "Aurora Vale", [1]),
    (2, "The Night Owls", [2]),
    (3, "Zoë Marlowe", [3]),
    (4, "Aurora Vale & The Night Owls", [1, 2]),
]
RELEASE_STATUS = [(1, "Official"), (3, "Bootleg")]
PRIMARY_TYPES = [(1, "Album"), (2, "Single"), (11, "Other")]
SECONDARY_TYPES = [(1, "Compilation"), (6, "Live")]
RELEASE_GROUPS = [  # id, name, artist_credit, primary type, [secondary types]
    (501, "First Light", 1, 1, []),
    (502, "Greatest Hits", 1, 1, [1]),
    (503, "Live at the Pier", 1, 1, [6]),
    (504, "Paper Lanterns", 3, 2, []),
    (505, "Bootleg Tapes", 4, 1, []),
    (506, "Covers", 2, 1, []),
]
RELEASES = [  # id, release group, status, (year, month, day) or None, known country?
    (1001, 501, 1, (2015, 3, 2), True),
    (1002, 502, 1, (2020, None, None), True),
    (1003, 503, 1, (2016, 7, 1), True),
    (1004, 504, 1, (2018, 5, 4), False),   # date only in release_unknown_country
    (1005, 505, 3, (2017, 1, 1), True),
    (1006, 506, 1, (2019, 9, 9), True),
]
RECORDINGS = [  # id, name, artist_credit, length, comment, video, [release ids]
    (101, "Midnight Signal", 1, 200_000, "", False, [1001]),         # song A (representative: earliest)
    (102, "Midnight  Signal", 1, 201_000, "", False, [1002]),        # remaster on compilation -> song A
    (103, "Midnight Signal", 1, 230_000, "live, 2016", False, [1003]),  # live album -> excluded
    (104, "Paper Lanterns", 3, 185_000, "", False, [1004]),          # song B (has ISRC)
    (105, "Paper Lanterns (Instrumental)", 3, 185_000, "", False, [1004]),  # instrumental -> excluded
    (106, "Glass Harbor", 4, 240_000, "", False, [1005]),            # bootleg only -> excluded
    (107, "Glass Harbor", 4, 240_000, "", True, [1001]),             # music video -> excluded
    (108, "Midnight Signal", 2, 210_000, "", False, [1006]),         # cover by another artist -> song C
    (109, "Static Hearts", 4, 222_000, "", False, [1001]),           # duet -> song D (two artists)
]
ISRCS = [(1, 104, "USABC1800001")]


def _row(*values) -> str:
    out = []
    for v in values:
        if v is None:
            out.append(N)
        elif isinstance(v, bool):
            out.append("t" if v else "f")
        else:
            out.append(str(v))
    return "\t".join(out) + "\n"


def write_fake_dump(root: Path) -> Path:
    d = root / "mbdump"
    d.mkdir(parents=True)

    def write(table: str, rows: list[str]) -> None:
        (d / table).write_text("".join(rows))

    write("artist", [_row(i, gid(i), n, n, *[None] * 6, None, None, None, "", 0, TS, False, None, None)
                     for i, n in ARTISTS])
    write("artist_credit", [_row(i, n, len(a), 1, TS, 0, gid(9000 + i)) for i, n, a in ARTIST_CREDITS])
    write("artist_credit_name", [_row(i, pos, a, dict(ARTISTS)[a], " & " if pos < len(ids) - 1 else "")
                                 for i, _, ids in ARTIST_CREDITS for pos, a in enumerate(ids)])
    write("release_status", [_row(i, n, None, 0, None, gid(8000 + i)) for i, n in RELEASE_STATUS])
    write("release_group_primary_type", [_row(i, n, None, 0, None, gid(8100 + i)) for i, n in PRIMARY_TYPES])
    write("release_group_secondary_type", [_row(i, n, None, 0, None, gid(8200 + i)) for i, n in SECONDARY_TYPES])
    write("release_group", [_row(i, gid(500_000 + i), n, ac, t, "", 0, TS) for i, n, ac, t, _ in RELEASE_GROUPS])
    write("release_group_secondary_type_join", [_row(i, s, TS) for i, *_, secs in RELEASE_GROUPS for s in secs])
    rg_by_id = {r[0]: r for r in RELEASE_GROUPS}
    write("release", [_row(i, gid(i), rg_by_id[rg][1], rg_by_id[rg][2], rg, st, None, None, None, None, "", 0, -1, TS)
                      for i, rg, st, _, _ in RELEASES])
    write("release_country", [_row(i, 222, *date) for i, _, _, date, known in RELEASES if known])
    write("release_unknown_country", [_row(i, *date) for i, _, _, date, known in RELEASES if not known])
    write("medium", [_row(i, i, 1, 1, "", 0, TS, 1, gid(7000 + i)) for i, *_ in RELEASES])
    tracks, tid = [], 1
    for rid, name, ac, length, _, _, releases in RECORDINGS:
        for rel in releases:
            tracks.append(_row(tid, gid(60000 + tid), rid, rel, 1, "1", name, ac, length, 0, TS, False))
            tid += 1
    write("track", tracks)
    write("recording", [_row(i, gid(i), n, ac, ln, c, 0, TS, v) for i, n, ac, ln, c, v, _ in RECORDINGS])
    write("isrc", [_row(i, rec, code, 0, TS) for i, rec, code in ISRCS])
    (root / "TIMESTAMP").write_text("2024-01-01 00:00:00.000000+00\n")
    (root / "SCHEMA_SEQUENCE").write_text("30\n")
    return root


@pytest.fixture(scope="session")
def fake_dump(tmp_path_factory) -> Path:
    return write_fake_dump(tmp_path_factory.mktemp("dump"))


@pytest.fixture()
def conn():
    db.ensure_database(TEST_DSN)
    with psycopg.connect(TEST_DSN) as c:
        c.execute("DROP SCHEMA IF EXISTS catalog CASCADE")
        c.execute("DROP SCHEMA IF EXISTS mb CASCADE")
        c.commit()
        db.init_schema(c)
        yield c


@pytest.fixture()
def imported(conn, fake_dump):
    from karaoke_catalog.importer import import_musicbrainz
    import_musicbrainz(conn, fake_dump)
    return conn
