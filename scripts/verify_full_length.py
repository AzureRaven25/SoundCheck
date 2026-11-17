#!/usr/bin/env python3
"""Prove that acquisition sources give complete recordings, not previews.

For each provider, search a few queries through the `acquire` Edge Function, download every full-length result's
stream to a temp dir, decode it with ffprobe and compare the measured duration with the listed one. A source counts
only if the decoded file is > 60 s and within 5 % (or 6 s) of the listed duration.

  SUPABASE_URL=… SUPABASE_KEY=<publishable key> python3 scripts/verify_full_length.py [--per 4] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

QUERIES = ["love", "night", "blues", "piano", "summer", "dance", "rain", "home"]


def call(url: str, key: str, body: dict) -> dict:
    req = urllib.request.Request(f"{url}/functions/v1/acquire", data=json.dumps(body).encode(),
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def measure(stream_url: str, dest: str) -> tuple[float | None, int]:
    # curl: follows redirects (Audius content nodes) and uses the system trust store
    subprocess.run(["curl", "-sSfL", "--max-time", "300", "-A", "SoundCheck/0.2 (verify)", "-o", dest, stream_url], check=True,
                   capture_output=True)
    size = os.path.getsize(dest)
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dest],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip()), size
    except ValueError:
        return None, size


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=4, help="recordings to verify per provider")
    ap.add_argument("--providers", default="audius,ccmixter,openverse,jamendo")
    ap.add_argument("--json")
    a = ap.parse_args()
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]
    providers = a.providers.split(",")
    report: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        for p in providers:
            done, seen = 0, set()
            for q in QUERIES:
                if done >= a.per:
                    break
                res = call(url, key, {"action": "search", "q": q, "providers": [p], "limit": 6})
                src = next((s for s in res.get("sources", []) if s["id"] == p), None)
                if src and not src["ok"]:
                    print(f"{p}: {src.get('error')} {src.get('missing') or ''}")
                    break
                for c in res.get("results", []):
                    if done >= a.per or c["availability"] != "full" or c["external_id"] in seen:
                        continue
                    seen.add(c["external_id"])
                    listed = (c["duration_ms"] or 0) / 1000
                    try:
                        got, size = measure(c["stream_url"], os.path.join(tmp, "x"))
                    except Exception as e:  # noqa: BLE001
                        print(f"  FAIL {p} {c['title']!r}: {e}")
                        report.append({**c, "measured_s": None, "ok": False, "error": str(e)})
                        continue
                    ok = got is not None and got > 60 and (not listed or abs(got - listed) <= max(6, listed * 0.05))
                    print(f"  {'OK  ' if ok else 'FAIL'} {p:9} {c['title'][:38]:38} | {c['artist'][:22]:22} listed {listed:6.1f}s "
                          f"decoded {got or 0:6.1f}s {size / 1e6:5.1f} MB  karaoke={c['karaoke_ok']}")
                    report.append({**c, "measured_s": got, "bytes": size, "ok": ok})
                    done += ok
    total = sum(r["ok"] for r in report)
    print(f"\n{total} complete recordings verified across {len({r['provider'] for r in report if r['ok']})} providers")
    if a.json:
        json.dump(report, open(a.json, "w"), indent=1)
    return 0 if total else 1


if __name__ == "__main__":
    sys.exit(main())
