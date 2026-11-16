"""Link processed song bundles (services/pipeline output) to catalog songs."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

import psycopg

# "(Remastered 2011)", "- 2009 Remaster", "[Mono]", "(Radio Edit)" ... noise that
# store downloads add to titles but MusicBrainz keeps out of recording names.
_TITLE_NOISE = re.compile(
    r"\s*(?:[(\[][^)\]]*\b(?:remaster(?:ed)?|mono|stereo|deluxe|bonus track|single version|album version|radio edit)\b[^)\]]*[)\]]"
    r"|\s-\s[^-]*\b(?:remaster(?:ed)?|mono|stereo|single version|album version|radio edit)\b.*$)",
    re.IGNORECASE,
)


def clean_title(title: str) -> str:
    return _TITLE_NOISE.sub("", title).strip() or title


@dataclass
class Match:
    song_id: int | None
    method: str | None
    score: float | None


def _duration_ok(length_ms: int | None, duration_s: float | None, tolerance_s: float = 10) -> bool:
    return length_ms is None or duration_s is None or abs(length_ms / 1000 - duration_s) <= tolerance_s


def match_song(conn: psycopg.Connection, meta: dict) -> Match:
    duration = meta.get("duration")
    if mbid := meta.get("musicbrainz_recording_id"):
        row = conn.execute("SELECT song_id FROM catalog.song_recording WHERE recording_mbid = %s::uuid", (mbid,)).fetchone()
        if row:
            return Match(row[0], "recording_mbid", 1.0)
    if isrc := meta.get("isrc"):
        row = conn.execute(
            "SELECT i.song_id FROM catalog.song_isrc i JOIN catalog.song s ON s.id = i.song_id "
            "WHERE i.isrc = %s ORDER BY s.release_count DESC LIMIT 1", (isrc.replace("-", "").upper(),)
        ).fetchone()
        if row:
            return Match(row[0], "isrc", 1.0)

    title, artist = meta.get("title"), meta.get("artist")
    if not title or not artist:
        return Match(None, None, None)
    for candidate in dict.fromkeys([title, clean_title(title)]):
        rows = conn.execute(
            "SELECT id, length_ms FROM catalog.song "
            "WHERE norm_title = catalog.norm(%s) AND norm_artist = catalog.norm(%s) ORDER BY release_count DESC LIMIT 5",
            (candidate, artist),
        ).fetchall()
        for song_id, length_ms in rows:
            if _duration_ok(length_ms, duration):
                return Match(song_id, "exact", 1.0)

    rows = conn.execute(
        """
        SELECT id, length_ms,
               similarity(norm_title, catalog.norm(%(t)s)) AS ts,
               similarity(norm_artist, catalog.norm(%(a)s)) AS ars
        FROM catalog.song
        WHERE (norm_title || ' ' || norm_artist) %% catalog.norm(%(t)s || ' ' || %(a)s)
        ORDER BY similarity(norm_title, catalog.norm(%(t)s)) + similarity(norm_artist, catalog.norm(%(a)s)) DESC,
                 release_count DESC
        LIMIT 10
        """,
        {"t": clean_title(title), "a": artist},
    ).fetchall()
    for song_id, length_ms, ts, ars in rows:
        if ts >= 0.6 and ars >= 0.5 and _duration_ok(length_ms, duration, tolerance_s=5):
            return Match(song_id, "fuzzy", round((ts + ars) / 2, 3))
    return Match(None, None, None)


def read_bundle(bundle_dir: Path) -> dict | None:
    meta_path = bundle_dir / "meta.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text())
    meta["_has_lyrics"] = (bundle_dir / "lyrics.json").exists()
    return meta


def upsert_item(conn: psycopg.Connection, bundle_dir: Path, meta: dict) -> Match:
    m = match_song(conn, meta)
    conn.execute(
        """
        INSERT INTO catalog.library_item
            (bundle_id, song_id, title, artist, duration_s, has_lyrics, bundle_path, match_method, match_score, linked_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (bundle_id) DO UPDATE SET
            song_id = EXCLUDED.song_id, title = EXCLUDED.title, artist = EXCLUDED.artist,
            duration_s = EXCLUDED.duration_s, has_lyrics = EXCLUDED.has_lyrics, bundle_path = EXCLUDED.bundle_path,
            match_method = EXCLUDED.match_method, match_score = EXCLUDED.match_score, linked_at = now()
        """,
        (meta["id"], m.song_id, meta["title"], meta.get("artist"), meta.get("duration"), meta["_has_lyrics"],
         str(bundle_dir.resolve()), m.method, m.score),
    )
    return m


def link_library(conn: psycopg.Connection, library: Path) -> list[tuple[str, Match]]:
    """Scan a pipeline library folder and (re)link every bundle in it."""
    results = []
    for bundle_dir in sorted(p for p in library.iterdir() if p.is_dir()):
        meta = read_bundle(bundle_dir)
        if meta is None:
            continue
        results.append((meta["id"], upsert_item(conn, bundle_dir, meta)))
    conn.commit()
    return results


def relink_all(conn: psycopg.Connection) -> int:
    """Re-match every known library item (run after a catalog re-import)."""
    rows = conn.execute("SELECT bundle_path FROM catalog.library_item").fetchall()
    n = 0
    for (path,) in rows:
        meta = read_bundle(Path(path))
        if meta is not None:
            upsert_item(conn, Path(path), meta)
            n += 1
    conn.commit()
    return n
