"""Song search: full-text with prefix matching (search-as-you-type), fuzzy fallback for typos."""

from __future__ import annotations

import re
from dataclasses import dataclass

import psycopg
from psycopg.rows import class_row

_WORD = re.compile(r"\w+", re.UNICODE)
FUZZY_THRESHOLD = 0.45


@dataclass
class SongHit:
    id: int
    title: str
    artist_name: str
    length_ms: int | None
    first_release_date: int | None
    recording_mbid: str
    release_group_mbid: str | None
    release_count: int
    bundle_id: str | None   # set when the song is in the library (singable now)
    score: float

    @property
    def year(self) -> int | None:
        return self.first_release_date // 10000 if self.first_release_date else None

    @property
    def cover_url(self) -> str | None:
        if not self.release_group_mbid:
            return None
        return f"https://coverartarchive.org/release-group/{self.release_group_mbid}/front-250"


def to_prefix_tsquery(text: str) -> str | None:
    """'bohemian rhaps' -> 'bohemian & rhaps:*'. Only word characters survive, so it's safe to pass to to_tsquery."""
    words = [w.lower() for w in _WORD.findall(text)]
    if not words:
        return None
    parts = words[:-1] + [words[-1] + ":*" if len(words[-1]) >= 2 else words[-1]]
    return " & ".join(parts)


_SELECT = """
SELECT s.id, s.title, s.artist_name, s.length_ms, s.first_release_date,
       s.recording_mbid::text, s.release_group_mbid::text, s.release_count,
       li.bundle_id, {score} AS score
FROM catalog.song s
LEFT JOIN LATERAL (
    SELECT bundle_id FROM catalog.library_item l WHERE l.song_id = s.id ORDER BY linked_at LIMIT 1
) li ON true
"""


def search(conn: psycopg.Connection, query: str, limit: int = 20, available_only: bool = False) -> list[SongHit]:
    hits = _fulltext(conn, query, limit, available_only)
    if not hits:
        hits = _fuzzy(conn, query, limit, available_only)
    return hits


def _fulltext(conn, query, limit, available_only) -> list[SongHit]:
    tsq = to_prefix_tsquery(query)
    if tsq is None:
        return []
    sql = (
        _SELECT.format(score="ts_rank_cd(s.search, q) * (1 + ln(1 + s.release_count))")
        + ", to_tsquery('simple', catalog.immutable_unaccent(%(tsq)s)) q WHERE s.search @@ q"
        + (" AND li.bundle_id IS NOT NULL" if available_only else "")
        + " ORDER BY (li.bundle_id IS NOT NULL) DESC, score DESC, s.id LIMIT %(limit)s"
    )
    with conn.cursor(row_factory=class_row(SongHit)) as cur:
        return cur.execute(sql, {"tsq": tsq, "limit": limit}).fetchall()


def _fuzzy(conn, query, limit, available_only) -> list[SongHit]:
    if not query.strip():
        return []
    sql = (
        _SELECT.format(score="word_similarity(catalog.norm(%(q)s), s.norm_title || ' ' || s.norm_artist)")
        + " WHERE catalog.norm(%(q)s) <%% (s.norm_title || ' ' || s.norm_artist)"
        + (" AND li.bundle_id IS NOT NULL" if available_only else "")
        + " ORDER BY score DESC, s.release_count DESC, s.id LIMIT %(limit)s"
    )
    # Default cutoff (0.6) misses ordinary typos like "midnite signall" (~0.55).
    with conn.transaction(), conn.cursor(row_factory=class_row(SongHit)) as cur:
        cur.execute(f"SET LOCAL pg_trgm.word_similarity_threshold = {FUZZY_THRESHOLD}")
        return cur.execute(sql, {"q": query, "limit": limit}).fetchall()
