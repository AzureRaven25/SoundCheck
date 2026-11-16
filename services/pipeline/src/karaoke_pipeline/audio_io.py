"""Audio decode/encode via ffmpeg (handles MP3, FLAC, ALAC, AAC, WAV, ...)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 44_100


def _require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise RuntimeError("ffmpeg not found on PATH (macOS: `brew install ffmpeg`)")
    return exe


def load_audio(path: Path, sample_rate: int = SAMPLE_RATE, channels: int = 2) -> np.ndarray:
    """Decode any audio file to float32 of shape (channels, samples)."""
    cmd = [
        _require_ffmpeg(), "-nostdin", "-v", "error", "-i", str(path),
        "-map", "0:a:0", "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", str(channels), "-ar", str(sample_rate), "-",
    ]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    audio = np.frombuffer(raw, dtype=np.float32)
    return audio.reshape(-1, channels).T.copy()


def encode_aac(audio: np.ndarray, dest: Path, sample_rate: int = SAMPLE_RATE, bitrate: str = "256k") -> None:
    """Encode (channels, samples) float32 audio to an AAC .m4a file."""
    channels = audio.shape[0]
    pcm = np.clip(audio, -1.0, 1.0).T.astype(np.float32).tobytes()
    cmd = [
        _require_ffmpeg(), "-nostdin", "-v", "error", "-y",
        "-f", "f32le", "-ar", str(sample_rate), "-ac", str(channels), "-i", "-",
        "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart", str(dest),
    ]
    subprocess.run(cmd, input=pcm, check=True, capture_output=True)
