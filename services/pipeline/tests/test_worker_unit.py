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
