"""Export the long tail of the ranked song list to Turso (libSQL) as a read-only search tier.

Tiering (docs/RESEARCH.md §9): Supabase holds the active catalog (top ranks + every song a user
touches). Turso holds ranks beyond that as denormalised song documents with an FTS5 index. The
catalog-search Edge Function queries Turso when Supabase has few matches and promotes the hits into
Supabase, where playlists/favorites/scores can reference them.

Environment: TURSO_DATABASE_URL (libsql://… or https://…), TURSO_AUTH_TOKEN (from .env.local).
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterable, Sequence

import httpx
import psycopg

SCHEMA = [
    """create table if not exists songs (
         rank integer primary key,          -- global popularity rank (1 = most released)
         id text not null unique,            -- representative recording MBID = Supabase tracks.id
         title text not null,
         artist_credit text not null,
         album_id text, album_title text, album_type text,
         release_year integer, duration_ms integer, popularity integer not null,
         credits text not null,              -- JSON [{position, artist_id, name, sort_name, join_phrase}]
         isrcs text not null,                -- JSON array
         recordings text not null            -- JSON array of every recording MBID of this song
       )""",
    """create virtual table if not exists songs_fts using fts5(
         title, artist_credit, content='songs', content_rowid='rank', tokenize='unicode61 remove_diacritics 2'
       )""",
    "create table if not exists meta (key text primary key, value text)",
]

EXPORT_SQL = """
with picked as (select * from mb.x_ranked where rank >= %(start)s and rank < %(end)s),
recs as (
  select p.rank, json_agg(xr.gid::text order by xr.appearances desc, xr.id) as recordings,
         coalesce(json_agg(distinct i.isrc) filter (where i.isrc is not null), '[]') as isrcs
  from picked p
  join mb.x_recording xr on xr.artist_credit = p.artist_credit and xr.norm_title = p.norm_title
  left join mb.isrc i on i.recording = xr.id
  group by p.rank
),
creds as (
  select acn.artist_credit, json_agg(json_build_object('position', acn.position, 'artist_id', a.gid::text, 'name', a.name,
           'sort_name', a.sort_name, 'join_phrase', acn.join_phrase) order by acn.position) as credits
  from mb.artist_credit_name acn join mb.artist a on a.id = acn.artist
  where acn.artist_credit in (select artist_credit from picked)
  group by acn.artist_credit
)
select p.rank, rec.gid::text, rec.name, ac.name, rg.gid::text, rg.name, lower(pt.name),
       case when p.first_date is null then null else p.first_date / 10000 end,
       nullif(rec.length, 0), p.popularity, coalesce(c.credits, '[]'::json)::text, r.isrcs::text, r.recordings::text
from picked p
join mb.recording rec on rec.id = p.rep_id
join mb.artist_credit ac on ac.id = p.artist_credit
left join mb.release_group rg on rg.id = p.first_release_group
left join mb.release_group_primary_type pt on pt.id = rg.type
left join creds c on c.artist_credit = p.artist_credit
left join recs r on r.rank = p.rank
order by p.rank
"""

INSERT = ("insert or replace into songs (rank, id, title, artist_credit, album_id, album_title, album_type, release_year, "
          "duration_ms, popularity, credits, isrcs, recordings) values (?,?,?,?,?,?,?,?,?,?,?,?,?)")


class Executor:
    def execute_many(self, statements: Sequence[tuple[str, Sequence]]) -> list[list[tuple]]:
        raise NotImplementedError


class SqliteExecutor(Executor):
    """Local SQLite (same FTS5 engine as libSQL): used by tests and for offline experiments."""

    def __init__(self, path: str = ":memory:"):
        self.db = sqlite3.connect(path)

    def execute_many(self, statements):
        out = []
        with self.db:
            for sql, args in statements:
                out.append(list(self.db.execute(sql, args).fetchall()))
        return out


def _hrana_value(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, bool):
        return {"type": "integer", "value": str(int(v))}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    return {"type": "text", "value": str(v)}


class TursoHttp(Executor):
    """Turso over HTTP (Hrana v2 pipeline). Each call runs its statements in one transaction."""

    def __init__(self, url: str, token: str):
        base = url.replace("libsql://", "https://").rstrip("/")
        self.client = httpx.Client(base_url=base, headers={"Authorization": f"Bearer {token}"}, timeout=120)

    def execute_many(self, statements):
        reqs = [{"type": "execute", "stmt": {"sql": "BEGIN"}}]
        reqs += [{"type": "execute", "stmt": {"sql": sql, "args": [_hrana_value(a) for a in args]}} for sql, args in statements]
        reqs += [{"type": "execute", "stmt": {"sql": "COMMIT"}}, {"type": "close"}]
        for attempt in range(6):
            try:
                r = self.client.post("/v2/pipeline", json={"requests": reqs})
            except httpx.TransportError:  # dropped connection / timeout: the batch is idempotent, so retry
                if attempt == 5:
                    raise
                time.sleep(2 ** attempt)
                continue
            if r.status_code < 300:
                break
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"turso pipeline failed ({r.status_code}): {r.text[:500]}")
        results = r.json()["results"]
        out = []
        for res in results[1:-2]:
            if res["type"] == "error":
                raise RuntimeError(f"turso statement failed: {res['error']}")
            rows = res["response"]["result"]["rows"]
            out.append([tuple(c.get("value") for c in row) for row in rows])
        return out


def init_schema(ex: Executor) -> None:
    ex.execute_many([(s, ()) for s in SCHEMA])


def export_window(conn: psycopg.Connection, ex: Executor, start: int, end: int, batch: int = 500) -> int:
    rows = conn.execute(EXPORT_SQL, {"start": start, "end": end}).fetchall()
    for i in range(0, len(rows), batch):
        ex.execute_many([(INSERT, r) for r in rows[i:i + batch]])
    return len(rows)


APOSTROPHES = ("'", "’", "‘")


def strip_apostrophes_sql(column: str) -> str:
    expr = column
    for a in APOSTROPHES:
        expr = f"replace({expr}, '{a.replace(chr(39), chr(39) * 2)}', '')"
    return expr


def rebuild_index(ex: Executor, chunk: int = 20000, log=print) -> None:
    """(Re)build the FTS index in chunks: one 'rebuild' over ~1M rows is too big for a single HTTP request."""
    lo, hi = ex.execute_many([("select coalesce(min(rank), 0), coalesce(max(rank), -1) from songs", ())])[0][0]
    lo, hi = int(lo), int(hi)
    ex.execute_many([("insert into songs_fts(songs_fts) values ('delete-all')", ())])
    for s in range(lo, hi + 1, chunk):
        # apostrophes removed so "dont" / "don't" / "don’t" all match (see match_query)
        ex.execute_many([("insert into songs_fts(rowid, title, artist_credit) "
                          f"select rank, {strip_apostrophes_sql('title')}, {strip_apostrophes_sql('artist_credit')} "
                          "from songs where rank >= ? and rank < ?", (s, s + chunk))])
    log(f"  search index rebuilt for ranks {lo:,}-{hi:,}")


def export(conn: psycopg.Connection, ex: Executor, start: int, end: int, window: int = 20000, log=print) -> int:
    init_schema(ex)
    total = 0
    for s in range(start, end, window):
        e = min(end, s + window)
        t0 = time.perf_counter()
        n = export_window(conn, ex, s, e)
        total += n
        log(f"  ranks {s:,}-{e - 1:,}: {n:,} songs ({time.perf_counter() - t0:.0f}s)")
    rebuild_index(ex, log=log)
    lo, hi = ex.execute_many([("select min(rank), max(rank) from songs", ())])[0][0]
    ex.execute_many([("insert or replace into meta (key, value) values ('ranks', ?)", (json.dumps([lo, hi]),))])
    return total


def index_range(ex: Executor, start: int, end: int) -> None:
    """Add songs ranked [start, end) to the search index (they must not be indexed yet)."""
    ex.execute_many([("insert into songs_fts(rowid, title, artist_credit) "
                      f"select rank, {strip_apostrophes_sql('title')}, {strip_apostrophes_sql('artist_credit')} "
                      "from songs where rank >= ? and rank < ?", (start, end))])


def export_append(conn: psycopg.Connection, ex: Executor, start: int, end: int, window: int = 20000, log=print) -> int:
    """Add ranks [start, end) beyond what's already exported, indexing each window as it lands.

    Unlike export(), it never rebuilds the whole index (that rewrites every existing row, which counts against
    Turso's monthly write quota), and a run stopped partway leaves every exported window searchable. Resume with a
    later --start. Ranks must be new: re-exporting existing ranks would index them twice.
    """
    init_schema(ex)
    have = ex.execute_many([("select coalesce(max(rank), 0) from songs", ())])[0][0][0]
    if start <= int(have):
        raise ValueError(f"append must start after the last exported rank ({int(have):,}); got {start:,}")
    total = 0
    for s in range(start, end, window):
        e = min(end, s + window)
        t0 = time.perf_counter()
        n = export_window(conn, ex, s, e)
        index_range(ex, s, e)
        lo, hi = ex.execute_many([("select min(rank), max(rank) from songs", ())])[0][0]
        ex.execute_many([("insert or replace into meta (key, value) values ('ranks', ?)", (json.dumps([lo, hi]),))])
        total += n
        log(f"  ranks {s:,}-{e - 1:,}: {n:,} songs ({time.perf_counter() - t0:.0f}s)", flush=True) if log is print else log(f"  ranks {s:,}-{e - 1:,}: {n:,} songs")
    return total


def match_query(q: str) -> str:
    """FTS5 query: every word must match, the last one as a prefix; words are quoted so input can't inject syntax."""
    q = q.lower()
    for a in APOSTROPHES:  # the index strips apostrophes too
        q = q.replace(a, "")
    words = [w for w in "".join(c if c.isalnum() else " " for c in q).split() if w][:8]
    if not words:
        return ""
    parts = [f'"{w}"' for w in words]
    if len(words[-1]) >= 2:
        parts[-1] += "*"
    return " ".join(parts)


SEARCH_SQL = ("select s.rank, s.id, s.title, s.artist_credit, s.release_year from songs_fts f join songs s on s.rank = f.rowid "
              "where songs_fts match ? order by s.rank limit ?")


def search(ex: Executor, q: str, limit: int = 20) -> list[tuple]:
    mq = match_query(q)
    return ex.execute_many([(SEARCH_SQL, (mq, limit))])[0] if mq else []


def iter_windows(start: int, end: int, size: int) -> Iterable[tuple[int, int]]:
    for s in range(start, end, size):
        yield s, min(end, s + size)
