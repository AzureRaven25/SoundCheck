"""The worker only downloads open-licensed originals from allow-listed hosts."""
from pathlib import Path

import pytest

from karaoke_pipeline.worker import Supabase


@pytest.mark.parametrize("url", [
    "http://archive.org/download/x/a.mp3",          # not https
    "https://example.com/a.mp3",                     # not the archive
    "https://archive.org.evil.com/a.mp3",            # look-alike host
    "file:///etc/passwd",
])
def test_refuses_urls_off_the_allow_list(url: str, tmp_path: Path) -> None:
    sb = Supabase("http://localhost", "key")
    with pytest.raises(ValueError):
        sb.fetch_url(url, tmp_path / "x.mp3")


from karaoke_pipeline.worker import redirect_allowed, url_allowed  # noqa: E402


@pytest.mark.parametrize("url", [
    "https://archive.org/download/x/a.mp3",
    "https://ia800300.us.archive.org/x/a.mp3",
    "https://api.audius.co/v1/tracks/abc/stream?app_name=SoundCheck",
    "https://prod-1.storage.jamendo.com/?trackid=1&format=mp32",
    "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/X.ogg/X.ogg.mp3",
])
def test_allows_open_sources(url: str) -> None:
    assert url_allowed(url)


@pytest.mark.parametrize("url", ["https://ccmixter.org/content/u/a.mp3", "https://archive.org.evil.com/a.mp3", "https://jamendo.com.evil.net/x"])
def test_refuses_lookalikes(url: str) -> None:
    assert not url_allowed(url)


def test_redirects() -> None:
    # Audius hands out content nodes on any public host
    assert redirect_allowed("api.audius.co", "https://creatornode.audius.co/tracks/cidstream/Qm")
    assert redirect_allowed("api.audius.co", "https://audius-node.example.net/tracks/x")
    assert not redirect_allowed("api.audius.co", "https://127.0.0.1/x")
    assert not redirect_allowed("api.audius.co", "https://10.0.0.5/x")
    assert not redirect_allowed("api.audius.co", "https://localhost/x")
    assert not redirect_allowed("api.audius.co", "http://node.example.net/x")
    # everyone else must stay on the allow-list
    assert not redirect_allowed("upload.wikimedia.org", "https://example.com/a.mp3")
    assert redirect_allowed("archive.org", "https://ia800300.us.archive.org/a.mp3")
