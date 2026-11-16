"""Reference melody extraction from the isolated vocal stem.

Produces two things the TV app needs for scoring and the pitch bar:
  * a frame-level pitch contour (MIDI floats, 10 ms hop, None when unvoiced)
  * a note list [{start, end, pitch}] where pitch is an integer MIDI note
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import librosa
import numpy as np
import torch
import torchcrepe

CREPE_SR = 16_000
HOP_SECONDS = 0.01
FMIN, FMAX = 65.0, 1100.0  # ~C2..C6, covers bass through soprano


@dataclass
class Note:
    start: float
    end: float
    pitch: int

    def to_json(self) -> dict:
        d = asdict(self)
        d["start"] = round(d["start"], 3)
        d["end"] = round(d["end"], 3)
        return d


def hz_to_midi(f0: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return 69.0 + 12.0 * np.log2(f0 / 440.0)


def track_pitch(vocals: np.ndarray, sample_rate: int, model: str = "full", device: str | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Run CREPE on a (channels, samples) vocal stem. Returns (f0_hz, periodicity) per 10 ms frame."""
    mono = vocals.mean(0) if vocals.ndim == 2 else vocals
    mono = librosa.resample(mono, orig_sr=sample_rate, target_sr=CREPE_SR)
    audio = torch.from_numpy(mono.astype(np.float32))[None]
    hop = int(CREPE_SR * HOP_SECONDS)
    # Apple GPU (MPS) is ~14x faster than CPU for the "full" model on Apple Silicon.
    if device is None:
        device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    f0, periodicity = torchcrepe.predict(
        audio, CREPE_SR, hop, FMIN, FMAX, model=model, batch_size=2048,
        device=device, return_periodicity=True, decoder=torchcrepe.decode.viterbi,
    )
    periodicity = torchcrepe.filter.median(periodicity, 3)
    f0 = torchcrepe.filter.mean(f0, 3)
    return f0[0].cpu().numpy(), periodicity[0].cpu().numpy()


def voiced_contour(f0: np.ndarray, periodicity: np.ndarray, rms: np.ndarray | None = None,
                   periodicity_threshold: float = 0.5, silence_db: float = -45.0) -> np.ndarray:
    """MIDI contour with NaN where the frame is unvoiced or (near) silent."""
    midi = hz_to_midi(f0.astype(np.float64))
    voiced = (periodicity >= periodicity_threshold) & np.isfinite(midi)
    if rms is not None:
        n = min(len(rms), len(midi))
        loud = np.zeros_like(voiced)
        loud[:n] = 20 * np.log10(np.maximum(rms[:n], 1e-10)) > silence_db
        voiced &= loud
    return np.where(voiced, midi, np.nan)


def segment_notes(contour: np.ndarray, hop: float = HOP_SECONDS, min_duration: float = 0.08,
                  max_gap: float = 0.03, split_semitones: float = 0.75, merge_gap: float = 0.05,
                  glide_max: float = 0.13, glide_gap: float = 0.1) -> list[Note]:
    """Group a MIDI contour (NaN = unvoiced) into discrete notes.

    A note continues while frames stay within `split_semitones` of the running
    median; short unvoiced gaps (<= max_gap) are bridged. Adjacent notes with the
    same rounded pitch separated by < merge_gap are merged. Short notes
    (< glide_max) wedged directly between two other notes are treated as the
    slide (portamento) from one to the next and absorbed into their neighbours.
    """
    notes: list[Note] = []
    max_gap_frames = int(round(max_gap / hop))
    current: list[float] = []
    start_idx = 0
    last_voiced_idx = -1
    gap = 0

    def close(end_idx: int) -> None:
        if current and (end_idx - start_idx + 1) * hop >= min_duration:
            notes.append(Note(start=start_idx * hop, end=(end_idx + 1) * hop, pitch=int(round(float(np.median(current))))))

    for i, value in enumerate(contour):
        if np.isnan(value):
            if current:
                gap += 1
                if gap > max_gap_frames:
                    close(last_voiced_idx)
                    current = []
            continue
        if current and abs(value - float(np.median(current))) > split_semitones:
            close(last_voiced_idx)
            current = []
        if not current:
            start_idx = i
        current.append(float(value))
        last_voiced_idx = i
        gap = 0
    close(last_voiced_idx)

    notes = _absorb_glides(notes, glide_max, glide_gap)

    merged: list[Note] = []
    for note in notes:
        if merged and merged[-1].pitch == note.pitch and note.start - merged[-1].end < merge_gap:
            merged[-1].end = note.end
        else:
            merged.append(note)
    return merged


def _absorb_glides(notes: list[Note], glide_max: float, touch_gap: float) -> list[Note]:
    out: list[Note] = []
    i = 0
    while i < len(notes):
        # Collect a run of short notes that touch each other.
        j = i
        while j < len(notes) and notes[j].end - notes[j].start < glide_max and \
                (j == i or notes[j].start - notes[j - 1].end < touch_gap):
            j += 1
        run = notes[i:j]
        prev_ok = bool(out) and run and run[0].start - out[-1].end < touch_gap
        next_ok = j < len(notes) and run and notes[j].start - run[-1].end < touch_gap
        if run and prev_ok and next_ok:
            # Split the glide time between the surrounding notes.
            mid = (run[0].start + run[-1].end) / 2
            out[-1].end = mid
            notes[j].start = mid
            i = j
            continue
        if run:
            out.extend(run)
            i = j
        else:
            out.append(notes[i])
            i += 1
    return out


def extract_melody(vocals: np.ndarray, sample_rate: int, crepe_model: str = "full") -> dict:
    f0, periodicity = track_pitch(vocals, sample_rate, model=crepe_model)
    mono = vocals.mean(0) if vocals.ndim == 2 else vocals
    hop_samples = int(sample_rate * HOP_SECONDS)
    rms = librosa.feature.rms(y=mono, frame_length=hop_samples * 4, hop_length=hop_samples, center=True)[0]
    contour = voiced_contour(f0, periodicity, rms)
    notes = segment_notes(contour)
    return {
        "hop": HOP_SECONDS,
        "contour": [None if np.isnan(v) else round(float(v), 2) for v in contour],
        "notes": [n.to_json() for n in notes],
        "range": _range(notes),
    }


def _range(notes: list[Note]) -> dict | None:
    if not notes:
        return None
    pitches = np.array([n.pitch for n in notes])
    durations = np.array([n.end - n.start for n in notes])
    order = np.argsort(pitches)
    cum = np.cumsum(durations[order]) / durations.sum()
    # 5th-95th percentile by sung time, so a single stray note doesn't define the range.
    low = int(pitches[order][np.searchsorted(cum, 0.05)])
    high = int(pitches[order][min(np.searchsorted(cum, 0.95), len(order) - 1)])
    return {"low": low, "high": high, "min": int(pitches.min()), "max": int(pitches.max())}
