"""Lyrics by ear: line splitting (pure) and, when the fixture song exists, a real transcription."""
import os
from pathlib import Path

import pytest

from karaoke_pipeline.transcribe import split_into_lines


def w(s: float, e: float, t: str) -> dict:
    return {"start": s, "end": e, "text": t}


def test_lines_break_on_pauses_length_and_sentence_ends() -> None:
    words = [w(0, .3, "Hello"), w(.3, .6, "there."), w(.7, 1, "How"), w(1, 1.2, "are"), w(1.2, 1.5, "you"),
             w(3.0, 3.3, "fine")] + [w(4 + i * .2, 4.1 + i * .2, f"w{i}") for i in range(10)]
    lines = split_into_lines(words)
    assert [ln["text"] for ln in lines[:2]] == ["Hello there.", "How are you"]  # sentence end, then a 1.5 s pause
    assert lines[2]["text"].startswith("fine w0")  # 0.7 s gap: same line
    assert all(len(ln["words"]) <= 8 for ln in lines)
    assert lines[0]["start"] == 0 and lines[0]["end"] == .6


SONG = os.environ.get("E2E_VOCALS")


@pytest.mark.skipif(not SONG or not Path(SONG).exists(), reason="set E2E_VOCALS to a sung vocal track")
def test_transcribes_sung_vocals() -> None:
    import soundfile as sf

    from karaoke_pipeline.transcribe import transcribe_vocals

    audio, sr = sf.read(SONG, always_2d=True)
    got = transcribe_vocals(audio.T, sr, model_size="base")
    assert got, "expected some lyrics"
    lines, _lang = got
    assert all(wd["end"] > wd["start"] for ln in lines for wd in ln["words"])
    print([ln["text"] for ln in lines])
