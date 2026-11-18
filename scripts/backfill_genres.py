#!/usr/bin/env python3
"""Fill tracks.genres for songs imported before genres were captured (Audius genre, Internet Archive subjects).

Same tag → genre rules as supabase/functions/_shared/genres.ts. Server-side only (secret key).

  SUPABASE_URL=… SUPABASE_SECRET_KEY=… python3 scripts/backfill_genres.py
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys
import urllib.parse
import urllib.request

RULES = [
    (r"hip[\s-]?hop|\brap\b|trap\b|boom ?bap|grime", "hip-hop"),
    (r"\br\s*&?\s*b\b|rnb|rhythm and blues", "r-and-b"),
    (r"\bsoul\b|motown|neo-soul", "soul"),
    (r"lo-?fi|chillhop", "lofi"),
    (r"\bhouse\b|techno|trance|edm|dubstep|drum ?(and|&|n) ?bass|\bdnb\b|electro|synth|idm|breakbeat|future bass", "electronic"),
    (r"(?<!folk )\bdance\b|disco|club", "dance"),
    (r"\bjazz|swing|bebop|big band", "jazz"),
    (r"\bblues", "blues"),
    (r"\bfolk|celtic|bluegrass|singer[\s-]?songwriter", "folk"),
    (r"country|americana", "country"),
    (r"acoustic|unplugged", "acoustic"),
    (r"classical|symphon|orchestr|sonata|concerto|baroque|opera|piano solo|chamber", "classical"),
    (r"reggae|dub\b|ska\b|dancehall", "reggae"),
    (r"latin|salsa|bossa|samba|reggaeton|cumbia|tango|flamenco|bachata", "latin"),
    (r"metal|hardcore|grindcore|doom", "metal"),
    (r"\bpunk|emo\b|post-punk", "punk"),
    (r"ambient|drone|new age|meditation|downtempo|chillout|\bchill\b", "ambient"),
    (r"\bworld\b|afro|african|indian|k-?pop|j-?pop|balkan|arabic|folk dance", "world"),
    (r"gospel|christian|worship|spiritual", "gospel"),
    (r"\bfunk", "funk"),
    (r"\bindie|alternative|alt-rock|shoegaze|dream pop", "indie"),
    (r"soundtrack|cinematic|film score|score\b|trailer|video game", "soundtrack"),
    (r"\brock|grunge|garage|psychedelic|prog", "rock"),
    (r"\bpop\b|synthpop|electropop|k-pop", "pop"),
]
COMPILED = [(re.compile(p, re.I), g) for p, g in RULES]


def to_genres(*tags: object) -> list[str]:
    flat: list[str] = []
    for t in tags:
        if isinstance(t, list):
            flat += [str(x) for x in t if x]
        elif isinstance(t, str) and t:
            flat.append(t)
    out: list[str] = []
    for t in flat:
        for rx, g in COMPILED:
            if rx.search(t.lower()) and g not in out:
                out.append(g)
    return out[:3]


def http(url: str, key: str | None = None, method: str = "GET", body: object | None = None) -> object:
    h = {"User-Agent": "SoundCheck/0.2 (genre backfill)", "Accept": "application/json"}
    if key:
        h |= {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"}
    r = urllib.request.Request(url, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def sources(rest: str, key: str, provider: str) -> list[dict]:
    out: list[dict] = []
    for off in range(0, 100_000, 1000):
        page = http(f"{rest}/track_sources?select=track_id,external_id,tracks!inner(genres)&provider=eq.{provider}"
                    f"&tracks.genres=eq.{{}}&order=id&limit=1000&offset={off}", key)
        out += page  # type: ignore[operator]
        if len(page) < 1000:  # type: ignore[arg-type]
            break
    return out


def apply(rest: str, key: str, updates: dict[str, list[str]]) -> int:
    by_genres: dict[tuple, list[str]] = collections.defaultdict(list)
    for tid, gs in updates.items():
        if gs:
            by_genres[tuple(gs)].append(tid)
    n = 0
    for gs, ids in by_genres.items():
        for i in range(0, len(ids), 100):
            http(f"{rest}/tracks?id=in.({','.join(ids[i:i + 100])})", key, "PATCH", {"genres": list(gs)})
            n += len(ids[i:i + 100])
    return n


def main() -> int:
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"]
    rest = f"{url}/rest/v1"

    # Audius: bulk track lookup, 50 ids per request
    au = sources(rest, key, "audius")
    updates: dict[str, list[str]] = {}
    for i in range(0, len(au), 50):
        batch = au[i:i + 50]
        q = "&".join(f"id={urllib.parse.quote(s['external_id'])}" for s in batch)
        try:
            data = http(f"https://api.audius.co/v1/tracks?{q}&app_name=SoundCheck")["data"]  # type: ignore[index]
        except Exception as e:  # noqa: BLE001
            print("audius batch failed:", e)
            continue
        genre = {t["id"]: to_genres(t.get("genre"), t.get("mood")) for t in data or []}
        for s in batch:
            updates[s["track_id"]] = genre.get(s["external_id"], [])
    print(f"audius: {len(au)} without genres, {sum(1 for g in updates.values() if g)} mapped → {apply(rest, key, updates)} updated")

    # Internet Archive: one metadata request per item (subjects + title apply to every track in it)
    ia = sources(rest, key, "internet_archive")
    items: dict[str, list[str]] = collections.defaultdict(list)
    for s in ia:
        items[s["external_id"].split("/", 1)[0]].append(s["track_id"])
    updates = {}
    for n, (ident, tids) in enumerate(items.items()):
        try:
            m = http(f"https://archive.org/metadata/{urllib.parse.quote(ident)}/metadata")["result"]  # type: ignore[index]
        except Exception as e:  # noqa: BLE001
            print("ia", ident, e)
            continue
        gs = to_genres(m.get("subject"), m.get("genre"), m.get("title"))
        for t in tids:
            updates[t] = gs
        if n % 50 == 0:
            print(f"  ia {n}/{len(items)}", flush=True)
    print(f"internet archive: {len(ia)} tracks in {len(items)} items, {sum(1 for g in updates.values() if g)} mapped → {apply(rest, key, updates)} updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
