"""Word-level lyric timing by forced alignment (torchaudio MMS_FA) against the isolated vocal stem.

Line-synced lyrics (LRC) give each line's start; we align the line's words inside its time window
on the vocal stem, which is far more reliable than aligning a whole song at once. Lines that fail
to align (non-Latin text with no romanisation, silence, instrumental bleed) fall back to spreading
the words over the melody notes in that window, then evenly by word length.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

ALIGN_SR = 16_000


@dataclass
class Word:
    start: float
    end: float
    text: str


def _romanize(word: str) -> str:
    """MMS_FA's vocabulary is lowercase a–z plus apostrophe; strip accents and everything else."""
    s = unicodedata.normalize("NFKD", word).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z']", "", s.replace("’", "'"))


@lru_cache(maxsize=1)
def _model():
    import torch
    from torchaudio.pipelines import MMS_FA

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = MMS_FA.get_model(with_star=False).to(device).eval()
    return model, MMS_FA.get_dict(star=None), device


def align_line(audio16k: np.ndarray, words: list[str], offset: float) -> list[Word] | None:
    """Align `words` inside a mono 16 kHz clip that starts at `offset` seconds. None if it can't."""
    import torch
    import torchaudio.functional as F

    tokens_per_word = [_romanize(w) for w in words]
    if not words or any(not t for t in tokens_per_word) or len(audio16k) < ALIGN_SR * 0.2:
        return None
    model, dictionary, device = _model()
    try:
        with torch.inference_mode():
            emission, _ = model(torch.from_numpy(audio16k.astype(np.float32))[None].to(device))
        emission = emission.cpu()
        flat = [dictionary[c] for t in tokens_per_word for c in t]
        if emission.shape[1] < len(flat):
            return None  # clip too short for the transcript
        alignment, scores = F.forced_align(emission, torch.tensor([flat], dtype=torch.int32), blank=0)
        spans = F.merge_tokens(alignment[0], scores[0].exp())
    except Exception:
        return None
    frame_s = audio16k.shape[0] / emission.shape[1] / ALIGN_SR
    out, i = [], 0
    for word, toks in zip(words, tokens_per_word):
        ws = spans[i:i + len(toks)]
        i += len(toks)
        if not ws:
            return None
        out.append(Word(round(offset + ws[0].start * frame_s, 3), round(offset + ws[-1].end * frame_s, 3), word))
    return out


def trim_to_voice(words: list[Word], rms: np.ndarray, hop_s: float, floor: float, min_len: float = 0.08) -> list[Word]:
    """CTC alignment lets a line's last word run on into the following silence: pull every word's end
    back to the last frame where the vocal stem is actually above the noise floor."""
    out = []
    for w in words:
        a, b = int(w.start / hop_s), int(w.end / hop_s)
        seg = rms[a:b]
        # relative to this word's own loudness: separation bleed after the voice stops sits well below it
        level = max(floor, float(seg.max()) * 0.15) if len(seg) else floor
        voiced = np.nonzero(seg > level)[0] if b > a else np.array([], dtype=int)
        end = w.end if not len(voiced) else (a + voiced[-1] + 1) * hop_s
        out.append(Word(w.start, round(max(w.start + min_len, min(w.end, end)), 3), w.text))
    return out


def spread_words(words: list[str], start: float, end: float, onsets: list[float] | None = None) -> list[Word]:
    """Fallback timing: one word per note onset when they match up, else proportional to word length."""
    if not words:
        return []
    if onsets and len(onsets) >= len(words):
        times = onsets[: len(words)] + [end]
        return [Word(round(times[k], 3), round(times[k + 1], 3), w) for k, w in enumerate(words)]
    weights = np.array([max(1, len(w)) for w in words], dtype=float)
    edges = start + np.concatenate([[0], np.cumsum(weights)]) / weights.sum() * (end - start)
    return [Word(round(edges[k], 3), round(edges[k + 1], 3), w) for k, w in enumerate(words)]


def add_word_timing(lines: list[dict], vocals: np.ndarray, sample_rate: int, notes: list[dict]) -> tuple[list[dict], dict]:
    """Return lines with `words` added, plus stats {aligned, fallback}. Lines must have start/end/text."""
    import librosa

    mono = vocals.mean(0) if vocals.ndim == 2 else vocals
    audio16k = librosa.resample(mono, orig_sr=sample_rate, target_sr=ALIGN_SR)
    hop = int(ALIGN_SR * 0.01)
    rms = librosa.feature.rms(y=audio16k, frame_length=hop * 4, hop_length=hop)[0]
    floor = max(float(rms.max()) * 0.05, float(np.percentile(rms, 20)) * 2)
    stats = {"aligned": 0, "fallback": 0}
    out = []
    for line in lines:
        text = (line.get("text") or "").strip()
        if not text or line.get("start") is None:
            out.append(line)
            continue
        words = text.split()
        start, end = float(line["start"]), float(line["end"])
        # small margins: LRC timestamps are often a little early/late
        a = max(0.0, start - 0.25)
        b = min(len(audio16k) / ALIGN_SR, end + 0.25)
        clip = audio16k[int(a * ALIGN_SR): int(b * ALIGN_SR)]
        timed = align_line(clip, words, a)
        if timed:
            timed = trim_to_voice(timed, rms, hop / ALIGN_SR, floor)
            # a line's words can't run into the next line (alignment used a +0.25 s margin)
            timed = [Word(min(w.start, end), min(w.end, end), w.text) for w in timed]
            stats["aligned"] += 1
        else:
            onsets = [n["start"] for n in notes if start - 0.1 <= n["start"] < end]
            sung_end = max([n["end"] for n in notes if start - 0.1 <= n["start"] < end], default=end)
            timed = spread_words(words, start, min(end, sung_end), onsets)
            stats["fallback"] += 1
        out.append({**line, "words": [w.__dict__ for w in timed]})
    return out, stats
