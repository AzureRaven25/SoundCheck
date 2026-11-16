"""Vocal / instrumental separation with HTDemucs."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model


@dataclass
class Stems:
    vocals: np.ndarray        # (channels, samples)
    instrumental: np.ndarray  # (channels, samples) = sum of all non-vocal sources
    sample_rate: int
    model: str


def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


@lru_cache(maxsize=2)
def _load(model_name: str):
    model = get_model(model_name)
    model.eval()
    return model


def separate(audio: np.ndarray, sample_rate: int, model_name: str = "htdemucs", device: str | None = None) -> Stems:
    """Split a stereo mix into vocals + instrumental.

    `htdemucs` is the fast default; `htdemucs_ft` is ~4x slower and a bit cleaner.
    """
    model = _load(model_name)
    if sample_rate != model.samplerate:
        raise ValueError(f"expected {model.samplerate} Hz audio, got {sample_rate}")
    device = device or pick_device()

    wav = torch.from_numpy(audio)
    # Same normalisation the demucs CLI uses.
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    wav = (wav - mean) / std

    with torch.no_grad():
        sources = apply_model(model, wav[None], device=device, shifts=1, split=True, overlap=0.25, progress=False)[0]
    sources = sources * std + mean

    names = list(model.sources)
    vocal_idx = names.index("vocals")
    vocals = sources[vocal_idx]
    instrumental = sources[[i for i in range(len(names)) if i != vocal_idx]].sum(0)
    return Stems(
        vocals=vocals.cpu().numpy().astype(np.float32),
        instrumental=instrumental.cpu().numpy().astype(np.float32),
        sample_rate=sample_rate,
        model=model_name,
    )
