"""Read title/artist/album/duration from file tags, with a filename fallback."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import mutagen


@dataclass
class TrackInfo:
    title: str
    artist: str | None
    album: str | None
    duration: float | None


def _first(tags: dict, *keys: str) -> str | None:
    for key in keys:
        value = tags.get(key)
        if value:
            text = str(value[0] if isinstance(value, list) else value).strip()
            if text:
                return text
    return None


def read_track_info(path: Path) -> TrackInfo:
    title = artist = album = None
    duration = None
    try:
        f = mutagen.File(path, easy=True)
    except Exception:
        f = None
    if f is not None:
        tags = dict(f.tags or {})
        title = _first(tags, "title")
        artist = _first(tags, "artist", "albumartist")
        album = _first(tags, "album")
        if f.info is not None and getattr(f.info, "length", None):
            duration = float(f.info.length)
    if title is None:
        # Fall back to "Artist - Title.ext" filenames.
        stem = path.stem
        if " - " in stem:
            maybe_artist, title = (s.strip() for s in stem.split(" - ", 1))
            artist = artist or maybe_artist
        else:
            title = stem
    return TrackInfo(title=title, artist=artist, album=album, duration=duration)
