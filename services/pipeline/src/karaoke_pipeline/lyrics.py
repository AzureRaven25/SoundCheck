"""Synced lyrics from LRCLIB (https://lrclib.net), parsed from LRC to JSON lines."""

from __future__ import annotations

import re

import httpx

LRCLIB = "https://lrclib.net/api"
USER_AGENT = "KaraokeApp-pipeline/0.1 (personal project)"

_TIMESTAMP = re.compile(r"\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]")


def parse_lrc(lrc: str, song_end: float | None = None) -> list[dict]:
    """Parse LRC into [{start, end, text}] sorted by time. Metadata tags are ignored.

    Empty-text lines are kept (they mark instrumental breaks). Each line ends
    where the next begins; the last ends at `song_end` (or start + 5 s).
    """
    entries: list[tuple[float, str]] = []
    for raw in lrc.splitlines():
        stamps = list(_TIMESTAMP.finditer(raw))
        if not stamps:
            continue
        text = raw[stamps[-1].end():].strip()
        for m in stamps:
            seconds = int(m.group(1)) * 60 + float(m.group(2).replace(":", "."))
            entries.append((seconds, text))
    entries.sort(key=lambda e: e[0])

    lines = []
    for i, (start, text) in enumerate(entries):
        if i + 1 < len(entries):
            end = entries[i + 1][0]
        else:
            end = max(song_end, start) if song_end else start + 5.0
        lines.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    return lines


def _best(results: list[dict], duration: float | None) -> dict | None:
    synced = [r for r in results if r.get("syncedLyrics")]
    if not synced:
        return None
    if duration is None:
        return synced[0]
    best = min(synced, key=lambda r: abs((r.get("duration") or 0) - duration))
    return best if abs((best.get("duration") or 0) - duration) <= 5 else None


def fetch_synced_lyrics(title: str, artist: str | None, album: str | None, duration: float | None,
                        client: httpx.Client | None = None) -> dict | None:
    """Return {"source", "lrclib_id", "lines": [...]} or None if nothing synced was found."""
    own = client is None
    client = client or httpx.Client(timeout=15, headers={"User-Agent": USER_AGENT})
    try:
        record = None
        if artist:
            params = {"track_name": title, "artist_name": artist}
            if album:
                params["album_name"] = album
            if duration:
                params["duration"] = str(round(duration))
            r = client.get(f"{LRCLIB}/get", params=params)
            if r.status_code == 200 and r.json().get("syncedLyrics"):
                record = r.json()
        if record is None:
            params = {"track_name": title}
            if artist:
                params["artist_name"] = artist
            r = client.get(f"{LRCLIB}/search", params=params)
            if r.status_code == 200:
                record = _best(r.json(), duration)
        if record is None:
            return None
        return {
            "source": "lrclib",
            "lrclib_id": record.get("id"),
            "lines": parse_lrc(record["syncedLyrics"], song_end=duration),
        }
    finally:
        if own:
            client.close()
