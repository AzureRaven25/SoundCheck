import json
import os
import sys
from pathlib import Path

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "catalog" / "tests"))
from conftest import TEST_DSN, write_fake_dump  # noqa: E402  (catalog test fixtures)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from karaoke_catalog import db
    from karaoke_catalog.importer import import_musicbrainz

    db.ensure_database(TEST_DSN)
    with psycopg.connect(TEST_DSN) as c:
        c.execute("DROP SCHEMA IF EXISTS catalog CASCADE")
        c.commit()
        db.init_schema(c)
        import_musicbrainz(c, write_fake_dump(tmp_path / "dump"))

    lib = tmp_path / "library"
    b = lib / "midnight-signal-abc"
    b.mkdir(parents=True)
    (b / "meta.json").write_text(json.dumps({
        "id": "midnight-signal-abc", "title": "Midnight Signal", "artist": "Aurora Vale", "duration": 200.0,
        "original_file": "original.mp3", "key": {"name": "C major"}, "tempo_bpm": 120.0,
        "vocal_range": {"low": 60, "high": 72}}))
    (b / "lyrics.json").write_text(json.dumps({"source": "test", "lines": [{"start": 1, "end": 2, "text": "la"}]}))
    (b / "melody.json").write_text(json.dumps({"hop": 0.01, "contour": [], "notes": []}))
    (b / "original.mp3").write_bytes(b"ID3fake")
    (b / "instrumental.m4a").write_bytes(b"fake-aac")

    monkeypatch.setenv("KARAOKE_DATABASE_URL", TEST_DSN)
    monkeypatch.setenv("KARAOKE_LIBRARY_DIR", str(lib))
    from karaoke_api.app import app
    with TestClient(app) as c:
        yield c


def test_health_and_search(client):
    assert client.get("/api/health").json() == {"ok": True, "catalog_songs": 4}
    hits = client.get("/api/songs/search", params={"q": "midnight sig"}).json()
    assert [(h["title"], h["artist"], h["bundle_id"]) for h in hits] == [
        ("Midnight Signal", "Aurora Vale", "midnight-signal-abc"),
        ("Midnight Signal", "The Night Owls", None),
    ]
    assert hits[0]["year"] == 2015 and hits[0]["cover_url"].startswith("https://coverartarchive.org/")
    assert client.get("/api/songs/search", params={"q": "midnight", "available": True}).json()[0]["bundle_id"]
    assert client.get("/api/songs/popular", params={"limit": 1}).json()[0]["title"] == "Midnight Signal"


def test_library_and_files(client):
    lib = client.get("/api/library").json()
    assert len(lib) == 1 and lib[0]["key"] == "C major" and lib[0]["year"] == 2015 and lib[0]["has_lyrics"]
    assert client.get("/api/library/midnight-signal-abc/lyrics").json()["lines"][0]["text"] == "la"
    assert client.get("/api/library/midnight-signal-abc/melody").status_code == 200
    assert client.get("/api/library/midnight-signal-abc/audio/original").content == b"ID3fake"
    assert client.get("/api/library/midnight-signal-abc/audio/instrumental").content == b"fake-aac"
    assert client.get("/api/library/midnight-signal-abc/audio/vocals").status_code == 404   # file missing
    assert client.get("/api/library/midnight-signal-abc/audio/secrets").status_code == 422  # not a stem
    assert client.get("/api/library/nope/lyrics").status_code == 404


def test_wishlist(client):
    song_id = client.get("/api/songs/search", params={"q": "paper lanterns"}).json()[0]["id"]
    assert client.put(f"/api/wishlist/{song_id}").status_code == 204
    assert [s["title"] for s in client.get("/api/wishlist").json()] == ["Paper Lanterns"]
    assert client.delete(f"/api/wishlist/{song_id}").status_code == 204
    assert client.get("/api/wishlist").json() == []
    assert client.put("/api/wishlist/999999").status_code == 404
