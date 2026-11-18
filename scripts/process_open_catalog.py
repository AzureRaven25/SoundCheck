#!/usr/bin/env python3
"""Queue shared karaoke versions of open-licensed songs (licenses that allow derivatives only).

Picks catalog songs with a karaoke-eligible full-length source (Openverse/Jamendo, Wikimedia Commons, Internet
Archive, CC-licensed Audius), registers the recording as a shared original and queues it for the normal pipeline
(admin_request_processing). Run the worker against the same project to process them.

Server-side only: needs the project's secret key, which must never leave this machine.

  SUPABASE_URL=… SUPABASE_SECRET_KEY=… python3 scripts/process_open_catalog.py --count 15 [--min-seconds 120 --max-seconds 330]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import urllib.request

PROVIDERS = ["openverse", "internet_archive", "audius", "jamendo"]
MIME = {"flac": "audio/flac", "ogg": "audio/ogg"}


def req(url: str, key: str, method: str = "GET", body: object | None = None, prefer: str | None = None) -> object:
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        h["Prefer"] = prefer
    r = urllib.request.Request(url, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r, timeout=60) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=15)
    ap.add_argument("--min-seconds", type=int, default=120)
    ap.add_argument("--max-seconds", type=int, default=330)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--queries", default="", help="comma-separated searches (e.g. 'female vocal,singer songwriter'): pick from these"
                    " results instead of at random, which favors songs with vocals; needs SUPABASE_PUBLISHABLE_KEY")
    a = ap.parse_args()
    url, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"]
    rest = f"{url}/rest/v1"

    if a.queries:
        pub = os.environ["SUPABASE_PUBLISHABLE_KEY"]
        picked: dict[str, dict] = {}
        for q in [x.strip() for x in a.queries.split(",") if x.strip()]:
            res = req(f"{url}/functions/v1/acquire", pub, "POST", {"action": "search", "q": q, "providers": ["openverse", "audius"], "limit": 20})
            for c in res["results"]:  # type: ignore[index]
                ms = c.get("duration_ms") or 0
                if c["karaoke_ok"] and c["availability"] == "full" and a.min_seconds * 1000 <= ms <= a.max_seconds * 1000:
                    picked.setdefault(f"{c['provider']}:{c['external_id']}", c)
        items = [{"provider": c["provider"], "external_id": c["external_id"]} for c in picked.values()]
        random.Random(a.seed).shuffle(items)
        imported = req(f"{url}/functions/v1/acquire", pub, "POST", {"action": "import_many", "items": items[:50]})["imported"]  # type: ignore[index]
        ids = ",".join(i["track_id"] for i in imported)
        print(f"{len(picked)} karaoke-eligible matches, {len(imported)} in the catalog")
        cands = req(f"{rest}/track_sources?select=track_id,provider,stream_url,license_url,duration_ms,format"
                    f"&karaoke_ok=is.true&stream_url=not.is.null&track_id=in.({ids})", key)
    else:
        cands = req(f"{rest}/track_sources?select=track_id,provider,stream_url,license_url,duration_ms,format"
                    f"&karaoke_ok=is.true&stream_url=not.is.null&provider=in.({','.join(PROVIDERS)})"
                    f"&duration_ms=gte.{a.min_seconds * 1000}&duration_ms=lte.{a.max_seconds * 1000}&limit=2000", key)
    done = {r["track_id"] for r in req(f"{rest}/audio_assets?select=track_id&owner_id=is.null&kind=eq.original&limit=5000", key)}
    pool = [c for c in cands if c["track_id"] not in done]  # type: ignore[union-attr]
    if not a.queries:
        random.Random(a.seed).shuffle(pool)
    print(f"{len(cands)} karaoke-eligible full recordings, {len(pool)} not yet prepared")  # type: ignore[arg-type]
    queued = 0
    for c in pool[: a.count]:
        asset = req(f"{rest}/audio_assets", key, "POST", {
            "track_id": c["track_id"], "owner_id": None, "kind": "original", "provider": c["provider"], "external_url": c["stream_url"],
            "license_url": c["license_url"], "duration_ms": c["duration_ms"], "mime_type": MIME.get(c.get("format") or "", "audio/mpeg"),
        }, prefer="return=representation")[0]  # type: ignore[index]
        job = req(f"{rest}/rpc/admin_request_processing", key, "POST", {"p_asset_id": asset["id"]})
        queued += 1
        print(f"queued {c['provider']:16} {c['track_id']} job {job}")
    print(f"{queued} queued")
    return 0


if __name__ == "__main__":
    sys.exit(main())
