"""Import a MusicBrainz full export (mbdump.tar.bz2) into the catalog.

Steps: extract only the tables we need -> COPY into unlogged mb.* staging tables
-> SQL transform into catalog.* -> rebuild indexes -> drop staging.
Get the dump from https://data.metabrainz.org/pub/musicbrainz/data/fullexport/
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

import psycopg

from .db import index_names, read_sql

TABLES = [
    "artist", "artist_credit", "artist_credit_name", "recording", "isrc", "track", "medium",
    "release", "release_group", "release_status", "release_group_primary_type",
    "release_group_secondary_type", "release_group_secondary_type_join",
    "release_country", "release_unknown_country",
]
COPY_CHUNK = 1 << 20


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def extract(archive: Path, dest: Path) -> Path:
    """Extract just the needed tables from mbdump.tar.bz2 into dest/mbdump/."""
    dest.mkdir(parents=True, exist_ok=True)
    members = [f"mbdump/{t}" for t in TABLES] + ["SCHEMA_SEQUENCE", "TIMESTAMP"]
    missing = [m for m in members if not (dest / m).exists()]
    if missing:
        _log(f"extracting {len(TABLES)} tables from {archive.name} (single-threaded bzip2, this is the slow part)")
        if shutil.which("lbzip2"):
            cmd = ["tar", "--use-compress-program=lbzip2", "-xf", str(archive), "-C", str(dest), *missing]
        else:
            cmd = ["tar", "-xjf", str(archive), "-C", str(dest), *missing]
        subprocess.run(cmd, check=True)
    return dest


def _staging_columns(conn: psycopg.Connection, table: str) -> int:
    return conn.execute(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'mb' AND table_name = %s", (table,)
    ).fetchone()[0]


def load_staging(conn: psycopg.Connection, dump_dir: Path) -> dict[str, int]:
    conn.execute(read_sql("staging.sql"))
    conn.commit()
    counts = {}
    for table in TABLES:
        path = dump_dir / "mbdump" / table
        if not path.exists():
            raise FileNotFoundError(f"missing dump table {path}")
        expected = _staging_columns(conn, table)
        with path.open("rb") as f:
            first = f.readline()
        if first and first.rstrip(b"\n").count(b"\t") + 1 != expected:
            raise RuntimeError(
                f"mb.{table}: dump has {first.count(b'\t') + 1} columns, staging expects {expected}. "
                "The MusicBrainz schema changed; update sql/staging.sql from admin/sql/CreateTables.sql."
            )
        t0 = time.perf_counter()
        with conn.cursor() as cur, path.open("rb") as f:
            with cur.copy(f"COPY mb.{table} FROM STDIN") as copy:
                while chunk := f.read(COPY_CHUNK):
                    copy.write(chunk)
            counts[table] = cur.rowcount
        conn.commit()
        _log(f"  mb.{table}: {counts[table]:,} rows ({time.perf_counter() - t0:.0f}s)")
    conn.execute("ANALYZE")
    conn.commit()
    return counts


def transform(conn: psycopg.Connection, source: str) -> dict[str, int]:
    run_id = conn.execute("INSERT INTO catalog.import_run (source) VALUES (%s) RETURNING id", (source,)).fetchone()[0]
    conn.commit()
    with conn.transaction():
        conn.execute("SET LOCAL work_mem = '1GB'")
        conn.execute("SET LOCAL maintenance_work_mem = '2GB'")
        conn.execute("SET LOCAL max_parallel_workers_per_gather = 6")
        for name in index_names():
            conn.execute(f"DROP INDEX IF EXISTS catalog.{name}")
        _log("building songs (grouping recordings, the heavy SQL step)")
        conn.execute(read_sql("transform.sql"))
        _log("building search indexes")
        conn.execute(read_sql("indexes.sql"))
        songs = conn.execute("SELECT count(*) FROM catalog.song").fetchone()[0]
        artists = conn.execute("SELECT count(*) FROM catalog.artist").fetchone()[0]
        conn.execute("UPDATE catalog.import_run SET finished_at = now(), songs = %s, artists = %s WHERE id = %s",
                     (songs, artists, run_id))
    conn.execute("ANALYZE catalog.song")
    conn.commit()
    return {"songs": songs, "artists": artists}


def import_musicbrainz(conn: psycopg.Connection, source: Path, workdir: Path | None = None,
                       keep_staging: bool = False) -> dict[str, int]:
    """`source` is either mbdump.tar.bz2 or a folder that already contains mbdump/<table> files."""
    if source.is_dir():
        dump_dir = source
    else:
        dump_dir = extract(source, workdir or source.parent / "extracted")
    stamp_file = dump_dir / "TIMESTAMP"
    stamp = stamp_file.read_text().strip() if stamp_file.exists() else "unknown"
    _log("loading staging tables")
    load_staging(conn, dump_dir)
    result = transform(conn, f"musicbrainz:{stamp}")
    if not keep_staging:
        conn.execute("DROP SCHEMA IF EXISTS mb CASCADE")
        conn.commit()
    _log(f"done: {result['songs']:,} songs, {result['artists']:,} artists")
    return result
