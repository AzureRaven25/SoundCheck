"""karaoke-catalog: build and query the song catalog.

    karaoke-catalog init-db
    karaoke-catalog import-musicbrainz data/musicbrainz/mbdump.tar.bz2
    karaoke-catalog link-library ../pipeline/library
    karaoke-catalog search "bohemian rhaps"
    karaoke-catalog wishlist add <song-id> | list
    karaoke-catalog stats

Database: $KARAOKE_DATABASE_URL (default postgresql:///karaoke).
"""

from __future__ import annotations

import argparse
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

    args = parser.parse_args(argv)
    if args.command == "wishlist" and args.action == "add" and args.song_id is None:
        parser.error("wishlist add needs a song id (from `search`)")
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
