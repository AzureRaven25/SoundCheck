"""Song structure derived from the reference melody: repeated-note splitting and phrases."""

from __future__ import annotations

import numpy as np


def split_repeated_notes(notes: list[dict], vocals: np.ndarray, sample_rate: int,
                         min_piece: float = 0.12, strength: float = 1.5) -> list[dict]:
    """Split notes at vocal onsets inside them.

    The contour segmenter merges consecutive syllables sung on the same pitch into one long note,
    which breaks rhythm scoring (docs/SCORING.md §3). A new syllable shows up as an onset (energy and
    spectral flux rise) inside the note; we split there when both resulting pieces are long enough.
    """
    import librosa

    mono = vocals.mean(0) if vocals.ndim == 2 else vocals
    hop = 256
    env = librosa.onset.onset_strength(y=mono, sr=sample_rate, hop_length=hop)
    if not len(env):
        return notes
    times = librosa.frames_to_time(np.arange(len(env)), sr=sample_rate, hop_length=hop)
    thresh = float(np.median(env) * strength + np.std(env) * 0.5)
    peaks = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=5, post_avg=5, delta=thresh * 0.3, wait=5)
    onsets = times[peaks][env[peaks] > thresh]

    out = []
    for n in notes:
        cuts = [t for t in onsets if n["start"] + min_piece <= t <= n["end"] - min_piece]
        edges = [n["start"], *cuts, n["end"]]
        for a, b in zip(edges, edges[1:]):
            out.append({**n, "start": round(float(a), 3), "end": round(float(b), 3)})
    return out


def phrases_from_lines(lines: list[dict], notes: list[dict]) -> list[dict]:
    """One phrase per sung lyric line: {start, end, noteIdx[]} (end = last sung note in the line)."""
    phrases = []
    for line in lines:
        if not (line.get("text") or "").strip() or line.get("start") is None:
            continue
        s, e = float(line["start"]), float(line["end"])
        idx = [i for i, n in enumerate(notes) if s - 0.15 <= n["start"] < e]
        if not idx:
            continue
        phrases.append({"start": notes[idx[0]]["start"], "end": notes[idx[-1]]["end"], "noteIdx": idx})
    return phrases


def phrases_from_gaps(notes: list[dict], gap: float = 0.3) -> list[dict]:
    """Without lyrics: split the melody wherever singing pauses for at least `gap` seconds."""
    phrases, cur = [], []
    for i, n in enumerate(notes):
        if cur and n["start"] - notes[cur[-1]]["end"] >= gap:
            phrases.append(cur)
            cur = []
        cur.append(i)
    if cur:
        phrases.append(cur)
    return [{"start": notes[p[0]]["start"], "end": notes[p[-1]]["end"], "noteIdx": p} for p in phrases]
