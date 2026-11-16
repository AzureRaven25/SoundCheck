import numpy as np

from karaoke_pipeline.analysis import estimate_key_from_chroma
from karaoke_pipeline.cli import slugify
from karaoke_pipeline.lyrics import parse_lrc
from karaoke_pipeline.melody import HOP_SECONDS, segment_notes


def _contour(*segments):
    """segments: (midi or None, seconds)"""
    out = []
    for pitch, secs in segments:
        n = int(round(secs / HOP_SECONDS))
        out += [np.nan if pitch is None else pitch] * n
    return np.array(out, dtype=float)


def test_segment_notes_basic():
    c = _contour((60, 0.5), (None, 0.2), (62.1, 0.3), (64, 0.4))
    notes = segment_notes(c)
    assert [n.pitch for n in notes] == [60, 62, 64]
    assert abs(notes[0].start - 0.0) < 1e-6 and abs(notes[0].end - 0.5) < 1e-6
    assert abs(notes[1].start - 0.7) < 1e-6


def test_segment_notes_bridges_short_gaps_and_drops_blips():
    c = _contour((60, 0.3), (None, 0.02), (60, 0.3), (None, 0.2), (70, 0.04))
    notes = segment_notes(c)
    assert len(notes) == 1 and notes[0].pitch == 60
    assert abs(notes[0].end - 0.62) < 1e-6


def test_segment_notes_tolerates_vibrato():
    t = np.arange(0, 1.0, HOP_SECONDS)
    c = 67 + 0.4 * np.sin(2 * np.pi * 5.5 * t)  # +-40 cents vibrato
    notes = segment_notes(c)
    assert len(notes) == 1 and notes[0].pitch == 67


def test_parse_lrc():
    lrc = "[ar:Someone]\n[00:01.50]first line\n[00:04.00]\n[00:05.25][00:20.00]repeated\n[00:10.000]last"
    lines = parse_lrc(lrc, song_end=30.0)
    assert [l["text"] for l in lines] == ["first line", "", "repeated", "last", "repeated"]
    assert lines[0] == {"start": 1.5, "end": 4.0, "text": "first line"}
    assert lines[-1]["start"] == 20.0 and lines[-1]["end"] == 30.0


def test_key_estimation_c_major_and_a_minor():
    c_major = np.zeros(12); c_major[[0, 4, 7]] = 1.0; c_major[[2, 5, 9, 11]] = 0.5
    assert estimate_key_from_chroma(c_major)["name"] == "C major"
    a_minor = np.zeros(12); a_minor[[9, 0, 4]] = 1.0; a_minor[[11, 2, 5, 7]] = 0.4
    assert estimate_key_from_chroma(a_minor)["name"] == "A minor"


def test_slugify():
    assert slugify("Beyoncé – Halo!") == "beyonce-halo"


def test_segment_notes_absorbs_glides_between_notes():
    # 60 -> brief slide through 61 and 59 -> 62, like CREPE output on portamento
    c = _contour((60, 0.55), (61, 0.1), (59, 0.1), (62, 0.55))
    notes = segment_notes(c)
    assert [n.pitch for n in notes] == [60, 62]
    assert abs(notes[0].end - notes[1].start) < 1e-6


def test_segment_notes_absorbs_glides_with_small_gaps():
    c = _contour((60, 0.5), (None, 0.06), (61, 0.09), (59, 0.09), (None, 0.01), (62, 0.55))
    assert [n.pitch for n in segment_notes(c)] == [60, 62]


def test_segment_notes_keeps_short_notes_after_a_rest():
    # A quick pickup note after a real rest is not a glide.
    c = _contour((60, 0.5), (None, 0.4), (64, 0.1), (65, 0.5))
    assert [n.pitch for n in segment_notes(c)] == [60, 64, 65]
