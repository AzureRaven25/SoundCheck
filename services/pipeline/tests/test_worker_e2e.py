"""End-to-end: upload → request_processing (as the user, under RLS) → worker → stems/analysis/lyrics in Supabase.

Runs against the local Supabase stack. Set SUPABASE_TEST_URL, SUPABASE_TEST_KEY (service/secret) and
SUPABASE_TEST_ANON (publishable) e.g. from `supabase status -o env`. Needs macOS `say` for the test song.
"""

import os
import shutil
import sys
import time
import uuid
from pathlib import Path

import httpx
import pytest

pytestmark = pytest.mark.skipif(
    not (os.environ.get("SUPABASE_TEST_URL") and os.environ.get("SUPABASE_TEST_ANON")) or not shutil.which("say"),
    reason="needs local Supabase (SUPABASE_TEST_URL/KEY/ANON) and macOS say",
)


def test_upload_to_karaoke_assets(tmp_path, monkeypatch):
    sys.path.insert(0, str(Path(__file__).parent / "fixtures"))
    import make_song
    from karaoke_pipeline import worker

    url, service, anon = os.environ["SUPABASE_TEST_URL"], os.environ["SUPABASE_TEST_KEY"], os.environ["SUPABASE_TEST_ANON"]
    admin = {"apikey": service, "Authorization": f"Bearer {service}"}
    http = httpx.Client(timeout=120)

    # a user, signed in (their JWT drives RLS)
    email, password = f"worker-{uuid.uuid4().hex[:8]}@soundcheck.test", "correct-horse-battery"
    r = http.post(f"{url}/auth/v1/admin/users", headers=admin, json={"email": email, "password": password, "email_confirm": True})
    r.raise_for_status()
    uid = r.json()["id"]
    tok = http.post(f"{url}/auth/v1/token?grant_type=password", headers={"apikey": anon},
                    json={"email": email, "password": password}).json()["access_token"]
    user = {"apikey": anon, "Authorization": f"Bearer {tok}"}

    # a catalog track with line-synced lyrics (as the LRCLIB function would store them)
    make_song.main(tmp_path)
    track_id = str(uuid.uuid4())
    http.post(f"{url}/rest/v1/tracks", headers=admin, json={"id": track_id, "title": "Testing Stage", "artist_credit": "Good News"}).raise_for_status()
    from karaoke_pipeline.lyrics import parse_lrc
    lines = parse_lrc((tmp_path / "test_song.lrc").read_text(), song_end=make_song.TOTAL)
    http.post(f"{url}/rest/v1/lyrics", headers=admin, json={"track_id": track_id, "provider": "lrclib", "granularity": "line",
                                                            "is_primary": True, "content": {"lines": lines}}).raise_for_status()

    try:
        # the user uploads their copy into their own folder and registers it (RLS-checked)
        path = f"{uid}/uploads/{track_id}/song.wav"
        http.post(f"{url}/storage/v1/object/audio/{path}", headers={**user, "Content-Type": "audio/wav"},
                  content=(tmp_path / "test_song.wav").read_bytes()).raise_for_status()
        asset = http.post(f"{url}/rest/v1/audio_assets", headers={**user, "Prefer": "return=representation"},
                          json={"track_id": track_id, "owner_id": uid, "kind": "original", "provider": "upload", "storage_path": path})
        asset.raise_for_status()
        asset_id = asset.json()[0]["id"]
        req = http.post(f"{url}/rest/v1/rpc/request_processing", headers=user, json={"p_asset_id": asset_id}).json()
        assert req[0]["status"] == "queued"

        # the worker picks it up
        monkeypatch.setenv("SUPABASE_URL", url)
        monkeypatch.setenv("SUPABASE_SECRET_KEY", service)
        t0 = time.time()
        assert worker.run(once=True, crepe_model="tiny") == 1
        print(f"worker took {time.time() - t0:.0f}s")

        # everything landed, and the user (not just the service role) can read it
        job = http.get(f"{url}/rest/v1/processing_jobs", headers=user, params={"asset_id": f"eq.{asset_id}"}).json()[0]
        assert job["status"] == "done", job["error"]
        stems = http.get(f"{url}/rest/v1/audio_assets", headers=user,
                         params={"source_asset_id": f"eq.{asset_id}", "select": "kind,storage_path"}).json()
        assert sorted(s["kind"] for s in stems) == ["instrumental", "vocals"]
        analysis = http.get(f"{url}/rest/v1/karaoke_analysis", headers=user, params={"source_asset_id": f"eq.{asset_id}"}).json()[0]
        assert len(analysis["notes"]) > 10 and len(analysis["phrases"]) == 4 and analysis["musical_key"]
        lyr = http.get(f"{url}/rest/v1/lyrics", headers=user, params={"track_id": f"eq.{track_id}", "is_primary": "eq.true"}).json()[0]
        assert lyr["provider"] == "aligned" and lyr["granularity"] == "word"
        assert all(line.get("words") for line in lyr["content"]["lines"] if line["text"])
        for s in stems:
            got = http.get(f"{url}/storage/v1/object/audio/{s['storage_path']}", headers=user)
            assert got.status_code == 200 and len(got.content) > 50_000   # user can download their stems
    finally:
        http.delete(f"{url}/rest/v1/tracks", headers=admin, params={"id": f"eq.{track_id}"})
        http.delete(f"{url}/auth/v1/admin/users/{uid}", headers=admin)
