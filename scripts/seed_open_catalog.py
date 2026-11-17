#!/usr/bin/env python3
"""Grow the catalog with complete, legally streamable recordings from the acquisition sources.

Searches the `acquire` Edge Function across genres and moods, keeps only `availability == "full"` results and imports
them (`import_many`, de-duplicated server-side). Prints per-provider counts and, at the end, the catalog's totals of
full-length sources per provider.

  SUPABASE_URL=… SUPABASE_KEY=<publishable key> python3 scripts/seed_open_catalog.py [--providers openverse,audius] [--per 20]
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time
import urllib.request

QUERIES = [
    "pop", "rock", "indie", "folk", "acoustic", "singer songwriter", "jazz", "blues", "soul", "funk", "r&b", "hip hop",
    "rap", "electronic", "dance", "house", "synthpop", "reggae", "country", "metal", "punk", "ballad", "love", "heart",
    "night", "summer", "dream", "home", "rain", "fire", "road", "sky", "song", "vocal", "piano", "guitar", "latin",
    "gospel", "christmas", "lullaby", "classical", "symphony", "sonata", "opera", "choir",
]


def call(url: str, key: str, body: dict, timeout: int = 120) -> dict:
    req = urllib.request.Request(f"{url}/functions/v1/acquire", data=json.dumps(body).encode(),
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def rest_count(url: str, key: str, provider: str) -> int:
    req = urllib.request.Request(
        f"{url}/rest/v1/track_sources?select=id&provider=eq.{provider}&stream_url=not.is.null",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "count=exact", "Range": "0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get("Content-Range", "*/0").split("/")[-1])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--providers", default="openverse,audius")
    ap.add_argument("--per", type=int, default=20, help="results per provider per query (max 25)")
    ap.add_argument("--queries", type=int, default=len(QUERIES))
    a = ap.parse_args()
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_KEY"]
    providers = a.providers.split(",")
    before = {p: rest_count(url, key, p) for p in providers}
    stats: collections.Counter[str] = collections.Counter()
    for q in QUERIES[: a.queries]:
        try:
            res = call(url, key, {"action": "search", "q": q, "providers": providers, "limit": a.per})
        except Exception as e:  # noqa: BLE001
            print(f"{q!r}: search failed: {e}")
            continue
        full = [{"provider": c["provider"], "external_id": c["external_id"]} for c in res["results"]
                if c["availability"] == "full" and not c.get("track_id")]
        bad = [s for s in res["sources"] if not s["ok"]]
        for i in range(0, len(full), 50):
            out = call(url, key, {"action": "import_many", "items": full[i:i + 50]}, timeout=300)
            for it in out["imported"]:
                stats[f"{it['provider']} {'new' if it['created'] else 'matched'}"] += 1
            for it in out["failed"]:
                stats[f"{it['provider']} failed"] += 1
        print(f"{q!r}: {len(full)} new full-length results" + (f" (unavailable: {[s['id'] for s in bad]})" if bad else ""), flush=True)
        time.sleep(1.5)  # be gentle with Openverse's anonymous limits
    after = {p: rest_count(url, key, p) for p in providers}
    print("\nimport results:", dict(stats))
    for p in providers:
        print(f"{p:10} full-length sources in catalog: {before[p]} → {after[p]} (+{after[p] - before[p]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
