"""Build a realistic test song on macOS: a singing TTS voice ("Good News") over a synthetic backing.

Demucs treats the TTS voice as vocals (unlike pure synthesized tones), so the whole pipeline can be
exercised: separation, melody, note splitting, and word alignment against known lyric timing.
Usage: python make_song.py OUT_DIR   →  OUT_DIR/test_song.wav, OUT_DIR/test_song.lrc, OUT_DIR/vocal_truth.wav
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44_100
LINES = [  # (start seconds, text): original placeholder lyrics written for testing
    (2.0, "Hello from the testing stage"),
    (8.0, "Every singer finds a voice"),
    (14.0, "Sing it loud and sing it clear"),
    (20.0, "Thank you for listening here"),
]
TOTAL = 27.0


def render_voice(text: str, tmp: Path) -> np.ndarray:
    out = tmp / "line.aiff"
    subprocess.run(["say", "-v", "Good News", "-o", str(out), text], check=True)
    import librosa
    y, sr = sf.read(out, dtype="float32")
    y = y.mean(1) if y.ndim == 2 else y
    return librosa.resample(y, orig_sr=sr, target_sr=SR)


def backing(n: int) -> np.ndarray:
    t = np.arange(n) / SR
    mix = np.zeros(n)
    prog = [(48, 52, 55), (45, 48, 52), (41, 45, 48), (43, 47, 50)]
    for i, start in enumerate(np.arange(0, TOTAL, 2.0)):
        a, b = int(start * SR), min(n, int((start + 2) * SR))
        tt = np.arange(b - a) / SR
        env = np.minimum(1, tt * 8) * np.exp(-tt * 0.6)
        for p in prog[i % 4]:
            mix[a:b] += 0.05 * env * np.sin(2 * np.pi * 440 * 2 ** ((p - 69) / 12) * tt)
    for beat in np.arange(0, TOTAL, 0.5):
        a = int(beat * SR)
        k = np.arange(min(5000, n - a))
        mix[a:a + len(k)] += 0.35 * np.sin(2 * np.pi * 55 * k / SR) * np.exp(-k / 900)
    return mix


def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    n = int(TOTAL * SR)
    voice = np.zeros(n)
    lrc = []
    with tempfile.TemporaryDirectory() as td:
        for start, text in LINES:
            v = render_voice(text, Path(td))
            a = int(start * SR)
            voice[a:a + len(v)] += v[: n - a] * 0.8
            lrc.append(f"[{int(start // 60):02d}:{start % 60:05.2f}]{text}")
    mix = voice + backing(n)
    mix /= np.abs(mix).max() / 0.9
    sf.write(out_dir / "test_song.wav", np.stack([mix, mix * 0.98]).T, SR)
    sf.write(out_dir / "vocal_truth.wav", voice.astype(np.float32), SR)
    (out_dir / "test_song.lrc").write_text("\n".join(lrc) + "\n")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
