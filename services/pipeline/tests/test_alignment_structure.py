import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

from karaoke_pipeline.alignment import Word, spread_words, trim_to_voice
from karaoke_pipeline.structure import phrases_from_gaps, phrases_from_lines


def test_spread_words_uses_onsets_then_length():
    w = spread_words(["a", "bb", "ccc"], 10, 13, onsets=[10.0, 11.0, 12.0])
    assert [(x.start, x.end) for x in w] == [(10.0, 11.0), (11.0, 12.0), (12.0, 13.0)]
    w = spread_words(["a", "bbb"], 0, 4)               # no onsets: 1:3 by length
    assert [(x.start, x.end) for x in w] == [(0.0, 1.0), (1.0, 4.0)]


def test_trim_to_voice_cuts_trailing_silence():
    rms = np.zeros(300); rms[100:150] = 1.0            # voice from 1.0 s to 1.5 s (10 ms hop)
    [w] = trim_to_voice([Word(1.0, 2.5, "x")], rms, 0.01, 0.1)
    assert w.end == pytest.approx(1.5)


def test_phrases():
    notes = [{"start": 0.0, "end": 0.4}, {"start": 0.45, "end": 0.9}, {"start": 2.0, "end": 2.5}]
    assert [p["noteIdx"] for p in phrases_from_gaps(notes)] == [[0, 1], [2]]
    lines = [{"start": 0.0, "end": 1.9, "text": "one"}, {"start": 1.9, "end": 3.0, "text": ""}, {"start": 1.95, "end": 3.0, "text": "two"}]
    assert [p["noteIdx"] for p in phrases_from_lines(lines, notes)] == [[0, 1], [2]]


@pytest.mark.skipif(sys.platform != "darwin" or not shutil.which("say"), reason="needs macOS 'say' (Good News voice)")
def test_sung_song_end_to_end(tmp_path):
    """Real pipeline on a sung TTS track: separation quality, alignment of every line, word timing accuracy."""
    sys.path.insert(0, str(Path(__file__).parent / "fixtures"))
    import make_song
    from karaoke_pipeline.alignment import add_word_timing
    from karaoke_pipeline.audio_io import SAMPLE_RATE, load_audio
    from karaoke_pipeline.lyrics import parse_lrc
    from karaoke_pipeline.melody import extract_melody
    from karaoke_pipeline.separate import separate
    from karaoke_pipeline.structure import split_repeated_notes

    make_song.main(tmp_path)
    st = separate(load_audio(tmp_path / "test_song.wav"), SAMPLE_RATE)
    truth = load_audio(tmp_path / "vocal_truth.wav").mean(0)
    est = st.vocals.mean(0)[: len(truth)]
    target = np.dot(est, truth) / np.dot(truth, truth) * truth
    si_sdr = 10 * np.log10(np.sum(target ** 2) / np.sum((est - target) ** 2))
    assert si_sdr > 12, si_sdr                         # clean isolation of the sung voice

    notes = split_repeated_notes(extract_melody(st.vocals, SAMPLE_RATE, crepe_model="tiny")["notes"], st.vocals, SAMPLE_RATE)
    lines = parse_lrc((tmp_path / "test_song.lrc").read_text(), song_end=make_song.TOTAL)
    timed, stats = add_word_timing(lines, st.vocals, SAMPLE_RATE, notes)
    assert stats == {"aligned": 4, "fallback": 0}
    for (start, text), line in zip(make_song.LINES, timed):
        words = line["words"]
        assert [w["text"] for w in words] == text.split()
        assert abs(words[0]["start"] - start) < 0.3                     # first word lands on the line
        assert all(a["end"] <= b["start"] + 1e-6 for a, b in zip(words, words[1:]))   # monotonic
        assert words[-1]["end"] <= line["end"] + 1e-6                     # never runs into the next line
