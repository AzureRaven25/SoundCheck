#!/usr/bin/env python3
"""Give well-known songs genres, from their artists' MusicBrainz genres (free, 1 request/second).

Popular catalog songs (MusicBrainz/iTunes metadata) had no genres, so genre pages could only show open-licensed
tracks. This looks up the most popular artists' genres and tags those artists' songs that have none yet, using the
same tag → genre rules as supabase/functions/_shared/genres.ts (via scripts/backfill_genres.py).

  SUPABASE_URL=… SUPABASE_SECRET_KEY=… python3 scripts/backfill_artist_genres.py --artists 3000
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from backfill_genres import to_genres  # noqa: E402

UA = "SoundCheck/0.2 (genre backfill; open-source karaoke project)"


def http(url: str, key: str | None = None, method: str = "GET", body: object | None = None) -> object:
    h = {"User-Agent": UA, "Accept": "application/json"}
    if key:
        h |= {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"}
    r = urllib.request.Request(url, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def retry(fn, tries: int = 4):
    """Network hiccups shouldn't stop a long run."""
    for i in range(tries):
        try:
            return fn()
        except Exception:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--artists", type=int, default=3000)
    ap.add_argument("--start", type=int, default=0, help="resume from this artist index")
    a = ap.parse_args()
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"]
    rest = f"{url}/rest/v1"
    # the artists behind the most popular songs (sum of their songs' popularity), most popular first
    score: dict[str, list] = {}
    for off in range(0, 30000, 1000):
        page = retry(lambda: http(f"{rest}/tracks?select=popularity,track_artists(position,artists(id,mbid,name))&popularity=gt.0"
                                  f"&order=popularity.desc&limit=1000&offset={off}", key))
        for t in page:  # type: ignore[union-attr]
            for ta in t.get("track_artists") or []:
                ar = ta.get("artists")
                if ta.get("position") == 0 and ar and ar.get("mbid"):
                    e = score.setdefault(ar["id"], [0, ar])
                    e[0] += t["popularity"]
        if len(page) < 1000:  # type: ignore[arg-type]
            break
    artists = [e[1] for e in sorted(score.values(), key=lambda e: -e[0])][: a.artists]
    print(f"{len(artists)} artists", flush=True)
    tagged = songs = 0
    for n, ar in enumerate(artists):
        if n < a.start:
            continue
        d = None
        for attempt in range(3):   # MusicBrainz answers 503 when busy: back off and retry
            try:
                d = http(f"https://musicbrainz.org/ws/2/artist/{ar['mbid']}?inc=genres+tags&fmt=json")
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    print("mb", ar["name"], e, flush=True)
                time.sleep(2 + attempt * 3)
        if d is None:
            continue
        names = [g["name"] for g in sorted(d.get("genres") or [], key=lambda g: -g.get("count", 0))]  # type: ignore[union-attr]
        if not names:
            names = [t["name"] for t in sorted(d.get("tags") or [], key=lambda t: -t.get("count", 0))[:8]]  # type: ignore[union-attr]
        gs = to_genres(names)
        if gs:
            tagged += 1
            try:
                tids = [r["track_id"] for r in retry(lambda: http(f"{rest}/track_artists?select=track_id&artist_id=eq.{ar['id']}&position=eq.0&limit=5000", key))]  # type: ignore[union-attr]
                for i in range(0, len(tids), 150):
                    ids = ",".join(tids[i:i + 150])
                    retry(lambda: http(f"{rest}/tracks?id=in.({ids})&genres=eq.{{}}", key, "PATCH", {"genres": gs}))
                songs += len(tids)
            except Exception as e:  # noqa: BLE001
                print("db", ar["name"], e, flush=True)
        if n % 100 == 0:
            print(f"  {n}/{len(artists)} artists, {tagged} with genres, ~{songs} songs", flush=True)
        time.sleep(1.05)   # MusicBrainz: 1 request per second
    print(f"done: {tagged} artists tagged, ~{songs} songs considered", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
