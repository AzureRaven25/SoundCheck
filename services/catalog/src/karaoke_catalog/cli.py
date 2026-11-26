"""karaoke-catalog: build and query the song catalog.

    karaoke-catalog init-db
    karaoke-catalog import-musicbrainz data/musicbrainz/mbdump.tar.bz2
    karaoke-catalog link-library ../pipeline/library
    karaoke-catalog search "bohemian rhaps"
    karaoke-catalog wishlist add <song-id> | list
    karaoke-catalog stats
    karaoke-catalog sync-supabase --top 200000     # ranked subset -> SoundCheck cloud catalog

Database: $KARAOKE_DATABASE_URL (default postgresql:///karaoke).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from . import db
from .importer import import_musicbrainz
from .library import link_library, relink_all
from .search import search


def _fmt_len(ms: int | None) -> str:
    return f"{ms // 60000}:{ms // 1000 % 60:02d}" if ms else "-:--"


def cmd_init(args) -> int:
    db.ensure_database()
    with db.connect() as conn:
        db.init_schema(conn)
    print(f"catalog schema ready in {db.dsn()}")
    return 0


def cmd_import(args) -> int:
    db.ensure_database()
    with db.connect() as conn:
        db.init_schema(conn)
        import_musicbrainz(conn, args.source, workdir=args.workdir, keep_staging=args.keep_staging)
        n = relink_all(conn)
        if n:
            print(f"re-linked {n} library bundles")
    return 0


def cmd_link(args) -> int:
    with db.connect() as conn:
        results = link_library(conn, args.library)
    for bundle_id, m in results:
        status = f"{m.method} -> song {m.song_id}" if m.song_id else "not in catalog (still singable)"
        print(f"  {bundle_id}: {status}")
    print(f"{sum(1 for _, m in results if m.song_id)}/{len(results)} bundles matched")
    return 0


def cmd_search(args) -> int:
    with db.connect() as conn:
        hits = search(conn, args.query, limit=args.limit, available_only=args.available)
    if not hits:
        print("no matches")
        return 1
    for h in hits:
        mark = "♪" if h.bundle_id else " "
        year = h.year or "    "
        print(f"{mark} {h.id:>10}  {_fmt_len(h.length_ms):>5}  {year}  {h.title} — {h.artist_name}")
    print("\n♪ = in your library (singable now)")
    return 0


def cmd_wishlist(args) -> int:
    with db.connect() as conn:
        if args.action == "add":
            row = conn.execute("SELECT recording_mbid, title, artist_name FROM catalog.song WHERE id = %s",
                               (args.song_id,)).fetchone()
            if not row:
                print(f"no song with id {args.song_id}", file=sys.stderr)
                return 1
            conn.execute("INSERT INTO catalog.wishlist (recording_mbid) VALUES (%s) ON CONFLICT DO NOTHING", (row[0],))
            conn.commit()
            print(f"added: {row[1]} — {row[2]}")
        else:
            rows = conn.execute(
                "SELECT s.id, s.title, s.artist_name FROM catalog.wishlist w "
                "JOIN catalog.song_recording r ON r.recording_mbid = w.recording_mbid "
                "JOIN catalog.song s ON s.id = r.song_id ORDER BY w.added_at"
            ).fetchall()
            for song_id, title, artist in rows:
                print(f"  {song_id:>10}  {title} — {artist}")
            print(f"{len(rows)} songs on the wishlist")
    return 0


def cmd_stats(args) -> int:
    with db.connect() as conn:
        run = conn.execute("SELECT source, finished_at FROM catalog.import_run WHERE finished_at IS NOT NULL "
                           "ORDER BY id DESC LIMIT 1").fetchone()
        songs, artists = conn.execute("SELECT (SELECT count(*) FROM catalog.song), (SELECT count(*) FROM catalog.artist)").fetchone()
        lib, linked = conn.execute("SELECT count(*), count(song_id) FROM catalog.library_item").fetchone()
        size = conn.execute("SELECT pg_size_pretty(pg_database_size(current_database()))").fetchone()[0]
    print(f"last import: {run[0]} at {run[1]:%Y-%m-%d %H:%M}" if run else "no import yet")
    print(f"songs: {songs:,}   artists: {artists:,}   database size: {size}")
    print(f"library: {lib} bundles, {linked} matched to catalog songs")
    return 0


def cmd_sync_supabase(args) -> int:
    from .supabase_sync import SupabaseRest, load_env, sync

    load_env()
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example)", file=sys.stderr)
        return 1
    with db.connect() as conn:
        have = conn.execute("select to_regclass('mb.x_ranked') is not null").fetchone()[0]
        if not have:
            print("run sql/ranked_subset.sql first (builds mb.x_ranked)", file=sys.stderr)
            return 1
        rest = SupabaseRest(url, key)
        totals = sync(conn, rest, args.start, args.start + args.top, window=args.window)
    print("upserted:", ", ".join(f"{k}={v:,}" for k, v in totals.items()))
    print(f"cloud catalog now has {rest.count('tracks'):,} tracks")
    return 0


def cmd_export_turso(args) -> int:
    from .supabase_sync import load_env
    from .turso_export import TursoHttp, export, export_append

    load_env()
    url, token = os.environ.get("TURSO_DATABASE_URL"), os.environ.get("TURSO_AUTH_TOKEN")
    if not url or not token:
        print("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .env.local", file=sys.stderr)
        return 1
    with db.connect() as conn:
        run = export_append if args.append else export
        n = run(conn, TursoHttp(url, token), args.start, args.start + args.top, window=args.window)
    print(f"exported {n:,} songs to Turso (ranks {args.start:,}-{args.start + args.top - 1:,})")
    return 0


def cmd_backfill_artwork(args) -> int:
    from .artwork_backfill import backfill, load_staging
    from .supabase_sync import SupabaseRest, load_env

    load_env()
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        print("SUPABASE_URL and SUPABASE_SECRET_KEY must be set", file=sys.stderr)
        return 1
    with db.connect() as conn:
        if args.archive:
            load_staging(conn, args.archive, args.archive.parent / "caa")
        backfill(conn, SupabaseRest(url, key), args.max_rank)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="karaoke-catalog", description="Song catalog for KaraokeApp.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="create the database and schema").set_defaults(fn=cmd_init)

    p = sub.add_parser("import-musicbrainz", help="(re)build the catalog from a MusicBrainz full export")
    p.add_argument("source", type=Path, help="mbdump.tar.bz2, or a folder containing mbdump/<table> files")
    p.add_argument("--workdir", type=Path, help="where to extract tables (default: <archive dir>/extracted)")
    p.add_argument("--keep-staging", action="store_true", help="keep the raw mb.* tables for debugging")
    p.set_defaults(fn=cmd_import)

    p = sub.add_parser("link-library", help="match processed song bundles to catalog songs")
    p.add_argument("library", type=Path)
    p.set_defaults(fn=cmd_link)

    p = sub.add_parser("search", help="search songs by title and/or artist")
    p.add_argument("query")
    p.add_argument("-n", "--limit", type=int, default=20)
    p.add_argument("--available", action="store_true", help="only songs in your library")
    p.set_defaults(fn=cmd_search)

    p = sub.add_parser("wishlist", help="songs you want to add to your library")
    p.add_argument("action", choices=["add", "list"])
    p.add_argument("song_id", type=int, nargs="?")
    p.set_defaults(fn=cmd_wishlist)

    sub.add_parser("stats", help="catalog and library counts").set_defaults(fn=cmd_stats)

    p = sub.add_parser("sync-supabase", help="upsert the ranked song list into the SoundCheck Supabase catalog")
    p.add_argument("--start", type=int, default=1, help="first rank to sync (1 = most-released song)")
    p.add_argument("--top", type=int, default=200_000, help="how many ranks to sync")
    p.add_argument("--window", type=int, default=5000, help="songs per batch window")
    p.set_defaults(fn=cmd_sync_supabase)

    p = sub.add_parser("export-turso", help="export the long tail (beyond the Supabase subset) to the Turso search tier")
    p.add_argument("--start", type=int, default=100_001)
    p.add_argument("--top", type=int, default=900_000, help="how many ranks (default stays under Turso Free's monthly write quota)")
    p.add_argument("--window", type=int, default=20_000)
    p.add_argument("--append", action="store_true", help="add ranks beyond the last exported one, indexing as it goes (no full rebuild)")
    p.set_defaults(fn=cmd_export_turso)

    p = sub.add_parser("backfill-artwork", help="register Cover Art Archive covers for synced albums from the CAA dump")
    p.add_argument("--archive", type=Path, help="mbdump-cover-art-archive.tar.bz2 (loads staging; omit to reuse)")
    p.add_argument("--max-rank", type=int, default=100_001, help="albums of songs ranked below this")
    p.set_defaults(fn=cmd_backfill_artwork)

    args = parser.parse_args(argv)
    if args.command == "wishlist" and args.action == "add" and args.song_id is None:
        parser.error("wishlist add needs a song id (from `search`)")
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
