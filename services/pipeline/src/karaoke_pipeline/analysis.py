"""Musical key and tempo estimation."""

from __future__ import annotations

import librosa
import numpy as np

PITCH_CLASSES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

# Krumhansl-Kessler key profiles.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def estimate_key_from_chroma(chroma_mean: np.ndarray) -> dict:
    """Correlate a 12-bin chroma profile against all 24 major/minor keys."""
    best = None
    for mode, profile in (("major", _MAJOR), ("minor", _MINOR)):
        for tonic in range(12):
            corr = float(np.corrcoef(chroma_mean, np.roll(profile, tonic))[0, 1])
            if best is None or corr > best[0]:
                best = (corr, tonic, mode)
    corr, tonic, mode = best
    return {"tonic": PITCH_CLASSES[tonic], "mode": mode, "name": f"{PITCH_CLASSES[tonic]} {mode}", "confidence": round(corr, 3)}


def analyze(instrumental: np.ndarray, sample_rate: int) -> dict:
    mono = instrumental.mean(0) if instrumental.ndim == 2 else instrumental
    y = librosa.resample(mono, orig_sr=sample_rate, target_sr=22_050)
    chroma = librosa.feature.chroma_cqt(y=y, sr=22_050)
    tempo, _ = librosa.beat.beat_track(y=y, sr=22_050)
    return {
        "key": estimate_key_from_chroma(chroma.mean(axis=1)),
        "tempo_bpm": round(float(np.atleast_1d(tempo)[0]), 1),
    }
