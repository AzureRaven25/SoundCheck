"""Lyrics by ear: transcribe the separated vocal stem with Whisper (faster-whisper, runs locally on CPU).

Used only when no synced lyrics exist for a song (typical for independent / openly licensed music and for the
user's own recordings). Output has the same shape as aligned lyrics: lines with per-word timing, so Stage can
light up each word. Segments Whisper isn't confident about (instrumental passages, mumbling) are dropped
rather than shown as made-up words.
"""
from __future__ import annotations

import os
from functools import lru_cache

import numpy as np

ASR_SR = 16_000
MAX_WORDS_PER_LINE = 8
LINE_GAP_S = 0.8
# Whisper confidence filters (per segment)
MAX_NO_SPEECH = 0.6
MIN_AVG_LOGPROB = -1.1
MIN_WORD_PROB = 0.25


@lru_cache(maxsize=2)
def _model(size: str):
    from faster_whisper import WhisperModel

    return WhisperModel(size, device="cpu", compute_type="int8", cpu_threads=max(1, (os.cpu_count() or 4) - 1))


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return False
    return True


def split_into_lines(words: list[dict]) -> list[dict]:
    """Group timed words into display lines: break on pauses, long lines, and sentence ends."""
    lines: list[dict] = []
    cur: list[dict] = []
    for w in words:
        if cur and (w["start"] - cur[-1]["end"] > LINE_GAP_S or len(cur) >= MAX_WORDS_PER_LINE
                    or cur[-1]["text"].endswith((".", "?", "!"))):
            lines.append(cur)
            cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    return [{"start": ln[0]["start"], "end": ln[-1]["end"], "text": " ".join(w["text"] for w in ln), "words": ln} for ln in lines]


def transcribe_vocals(vocals: np.ndarray, sample_rate: int, model_size: str = "small") -> tuple[list[dict], str | None] | None:
    """Lines with word timing from the vocal stem, plus the detected language; None when nothing was sung clearly."""
    if not available():
        return None
    import librosa

    mono = vocals.mean(0) if vocals.ndim == 2 else vocals
    audio = librosa.resample(mono.astype(np.float32), orig_sr=sample_rate, target_sr=ASR_SR)
    peak = float(np.abs(audio).max()) or 1.0
    audio = (audio / peak * 0.9).astype(np.float32)
    segments, info = _model(model_size).transcribe(
        audio, word_timestamps=True, vad_filter=True, condition_on_previous_text=False, beam_size=5,
    )
    words: list[dict] = []
    for seg in segments:
        if seg.no_speech_prob > MAX_NO_SPEECH or seg.avg_logprob < MIN_AVG_LOGPROB:
            continue
        for w in seg.words or []:
            text = w.word.strip()
            if text and w.probability >= MIN_WORD_PROB and w.end > w.start:
                words.append({"start": round(float(w.start), 3), "end": round(float(w.end), 3), "text": text})
    if len(words) < 6:  # a few stray words on an instrumental aren't lyrics
        return None
    return split_into_lines(words), getattr(info, "language", None)
