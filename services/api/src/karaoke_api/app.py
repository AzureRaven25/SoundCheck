"""KaraokeApp HTTP API: catalog search, the singable library, and song bundle files."""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

from karaoke_catalog import db as catalog_db
from karaoke_catalog.library import link_library
from karaoke_catalog.search import SongHit, search

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_LIBRARY = REPO_ROOT / "services" / "pipeline" / "library"


def library_dir() -> Path:
    return Path(os.environ.get("KARAOKE_LIBRARY_DIR", DEFAULT_LIBRARY))


def cover_url(release_group_mbid: str | None) -> str | None:
    return f"https://coverartarchive.org/release-group/{release_group_mbid}/front-500" if release_group_mbid else None


class Song(BaseModel):
    id: int
    title: str
    artist: str
    year: int | None
    length_ms: int | None
    cover_url: str | None
    bundle_id: str | None   # present = singable now

    @classmethod
    def from_hit(cls, h: SongHit) -> "Song":
        return cls(id=h.id, title=h.title, artist=h.artist_name, year=h.year, length_ms=h.length_ms,
                   cover_url=cover_url(h.release_group_mbid), bundle_id=h.bundle_id)


class LibraryItem(BaseModel):
    bundle_id: str
    song_id: int | None
    title: str
    artist: str | None
    duration_s: float | None
    has_lyrics: bool
    year: int | None
    cover_url: str | None
    key: str | None
    tempo_bpm: float | None
    vocal_range: dict | None


pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    assert pool is not None, "app not started"
    return pool


def scan_library() -> int:
    lib = library_dir()
    if not lib.is_dir():
        return 0
    with get_pool().connection() as conn:
        return len(link_library(conn, lib))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    catalog_db.ensure_database()
    pool = ConnectionPool(catalog_db.dsn(), min_size=1, max_size=8, open=True)
    with pool.connection() as conn:
        catalog_db.init_schema(conn)
    scan_library()
    yield
    pool.close()


app = FastAPI(title="KaraokeApp API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/health")
def health() -> dict:
    with get_pool().connection() as conn:
        songs = conn.execute("SELECT count(*) FROM catalog.song").fetchone()[0]
    return {"ok": True, "catalog_songs": songs}


# ---------------------------------------------------------------- catalog

@app.get("/api/songs/search", response_model=list[Song])
def search_songs(q: str = Query(min_length=1, max_length=200), limit: int = Query(30, ge=1, le=100),
                 available: bool = False) -> list[Song]:
    with get_pool().connection() as conn:
        return [Song.from_hit(h) for h in search(conn, q, limit=limit, available_only=available)]


@app.get("/api/songs/popular", response_model=list[Song])
def popular_songs(limit: int = Query(30, ge=1, le=100)) -> list[Song]:
    """Most-released songs: a rough "classics everyone knows" shelf."""
    with get_pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT s.id, s.title, s.artist_name, s.first_release_date, s.length_ms, s.release_group_mbid::text,
                   (SELECT bundle_id FROM catalog.library_item l WHERE l.song_id = s.id LIMIT 1)
            FROM catalog.song s ORDER BY s.release_count DESC, s.id LIMIT %s
            """, (limit,)).fetchall()
    return [Song(id=r[0], title=r[1], artist=r[2], year=r[3] // 10000 if r[3] else None, length_ms=r[4],
                 cover_url=cover_url(r[5]), bundle_id=r[6]) for r in rows]


# ---------------------------------------------------------------- library

_LIBRARY_SQL = """
SELECT li.bundle_id, li.song_id, COALESCE(s.title, li.title), COALESCE(s.artist_name, li.artist),
       li.duration_s, li.has_lyrics, s.first_release_date, s.release_group_mbid::text, li.bundle_path
FROM catalog.library_item li LEFT JOIN catalog.song s ON s.id = li.song_id
"""


def _bundle_meta(path: str) -> dict:
    try:
        return json.loads((Path(path) / "meta.json").read_text())
    except (OSError, ValueError):
        return {}


def _library_item(row) -> LibraryItem:
    meta = _bundle_meta(row[8])
    key = (meta.get("key") or {}).get("name")
    return LibraryItem(bundle_id=row[0], song_id=row[1], title=row[2], artist=row[3], duration_s=row[4],
                       has_lyrics=row[5], year=row[6] // 10000 if row[6] else None, cover_url=cover_url(row[7]),
                       key=key, tempo_bpm=meta.get("tempo_bpm"), vocal_range=meta.get("vocal_range"))


@app.get("/api/library", response_model=list[LibraryItem])
def list_library() -> list[LibraryItem]:
    with get_pool().connection() as conn:
        rows = conn.execute(_LIBRARY_SQL + " ORDER BY li.linked_at DESC, li.bundle_id").fetchall()
    return [_library_item(r) for r in rows]


@app.post("/api/library/scan")
def rescan_library() -> dict:
    return {"bundles": scan_library()}


def _bundle_row(bundle_id: str):
    with get_pool().connection() as conn:
        row = conn.execute(_LIBRARY_SQL + " WHERE li.bundle_id = %s", (bundle_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "song not in library")
    return row


@app.get("/api/library/{bundle_id}", response_model=LibraryItem)
def get_library_item(bundle_id: str) -> LibraryItem:
    return _library_item(_bundle_row(bundle_id))


def _bundle_file(bundle_id: str, name: str) -> Path:
    bundle = Path(_bundle_row(bundle_id)[8]).resolve()
    path = (bundle / name).resolve()
    if path.parent != bundle or not path.is_file():
        raise HTTPException(404, f"{name} not available")
    return path


@app.get("/api/library/{bundle_id}/lyrics")
def get_lyrics(bundle_id: str) -> FileResponse:
    return FileResponse(_bundle_file(bundle_id, "lyrics.json"), media_type="application/json")


@app.get("/api/library/{bundle_id}/melody")
def get_melody(bundle_id: str) -> FileResponse:
    return FileResponse(_bundle_file(bundle_id, "melody.json"), media_type="application/json")


@app.get("/api/library/{bundle_id}/audio/{stem}")
def get_audio(bundle_id: str, stem: Literal["original", "instrumental", "vocals"]) -> FileResponse:
    if stem == "original":
        name = _bundle_meta(_bundle_row(bundle_id)[8]).get("original_file", "")
    else:
        name = f"{stem}.m4a"
    return FileResponse(_bundle_file(bundle_id, name))


# ---------------------------------------------------------------- wishlist

@app.get("/api/wishlist", response_model=list[Song])
def get_wishlist() -> list[Song]:
    with get_pool().connection() as conn:
        rows = conn.execute(
            """
            SELECT s.id, s.title, s.artist_name, s.first_release_date, s.length_ms, s.release_group_mbid::text
            FROM catalog.wishlist w
            JOIN catalog.song_recording r ON r.recording_mbid = w.recording_mbid
            JOIN catalog.song s ON s.id = r.song_id ORDER BY w.added_at DESC
            """).fetchall()
    return [Song(id=r[0], title=r[1], artist=r[2], year=r[3] // 10000 if r[3] else None, length_ms=r[4],
                 cover_url=cover_url(r[5]), bundle_id=None) for r in rows]


@app.put("/api/wishlist/{song_id}", status_code=204)
def add_to_wishlist(song_id: int) -> None:
    with get_pool().connection() as conn:
        row = conn.execute("SELECT recording_mbid FROM catalog.song WHERE id = %s", (song_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "no such song")
        conn.execute("INSERT INTO catalog.wishlist (recording_mbid) VALUES (%s) ON CONFLICT DO NOTHING", (row[0],))


@app.delete("/api/wishlist/{song_id}", status_code=204)
def remove_from_wishlist(song_id: int) -> None:
    with get_pool().connection() as conn:
        conn.execute("DELETE FROM catalog.wishlist WHERE recording_mbid = "
                     "(SELECT recording_mbid FROM catalog.song WHERE id = %s)", (song_id,))
