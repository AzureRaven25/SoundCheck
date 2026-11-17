"""`karaoke-pipeline process <file-or-folder> -o <library-dir>`

Builds one song bundle per input file:

    <library>/<song-id>/
        original.<ext>     exact copy of the input (bit-for-bit "as the artist intended")
        instrumental.m4a   everything except vocals
        vocals.m4a         isolated vocals (for the guide-vocal slider)
        melody.json        reference pitch contour + notes (scoring, pitch bar)
        lyrics.json        synced lyric lines (if found)
        meta.json          title/artist/key/tempo/vocal range/pipeline info
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import time
import unicodedata
from pathlib import Path

from . import __version__
from .audio_io import SAMPLE_RATE, encode_aac, load_audio
from .tags import read_track_info

AUDIO_EXTS = {".mp3", ".flac", ".m4a", ".aac", ".wav", ".aiff", ".aif", ".ogg", ".opus", ".alac"}


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "song"


def song_id(path: Path, artist: str | None, title: str) -> str:
    digest = hashlib.sha1(path.read_bytes()).hexdigest()[:8]
    return f"{slugify(f'{artist} {title}' if artist else title)[:60]}-{digest}"


def find_inputs(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    return sorted(p for p in target.rglob("*") if p.suffix.lower() in AUDIO_EXTS and not p.name.startswith("."))


def process_file(src: Path, library: Path, *, model: str, crepe_model: str, skip_lyrics: bool, force: bool) -> Path:
    # Heavy imports here so `--help` stays fast.
    from .analysis import analyze
    from .lyrics import fetch_synced_lyrics
    from .melody import extract_melody
    from .separate import separate

    info = read_track_info(src)
    out = library / song_id(src, info.artist, info.title)
    if (out / "meta.json").exists() and not force:
        print(f"  skip (already processed): {out.name}")
        return out
    out.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}

    def step(name: str):
        class _T:
            def __enter__(self):
                self.t = time.perf_counter()
                print(f"  {name}...", flush=True)
            def __exit__(self, *exc):
                timings[name] = round(time.perf_counter() - self.t, 2)
        return _T()

    with step("decode"):
        audio = load_audio(src, SAMPLE_RATE)
        duration = audio.shape[1] / SAMPLE_RATE
        shutil.copy2(src, out / f"original{src.suffix.lower()}")
    with step("separate"):
        stems = separate(audio, SAMPLE_RATE, model_name=model)
    with step("encode"):
        encode_aac(stems.instrumental, out / "instrumental.m4a")
        encode_aac(stems.vocals, out / "vocals.m4a")
    with step("melody"):
        melody = extract_melody(stems.vocals, SAMPLE_RATE, crepe_model=crepe_model)
        (out / "melody.json").write_text(json.dumps(melody, separators=(",", ":")))
    with step("analyze"):
        analysis = analyze(stems.instrumental, SAMPLE_RATE)

    lyrics_meta = None
    if not skip_lyrics:
        with step("lyrics"):
            try:
                lyrics = fetch_synced_lyrics(info.title, info.artist, info.album, info.duration or duration)
            except Exception as e:  # network trouble shouldn't sink the whole song
                print(f"    lyrics lookup failed: {e}")
                lyrics = None
            if lyrics:
                (out / "lyrics.json").write_text(json.dumps(lyrics, ensure_ascii=False, indent=1))
                lyrics_meta = {"source": lyrics["source"], "lines": len(lyrics["lines"]), "granularity": "line"}
            else:
                print("    no synced lyrics found")

    meta = {
        "id": out.name,
        "title": info.title,
        "artist": info.artist,
        "album": info.album,
        "musicbrainz_recording_id": info.musicbrainz_recording_id,
        "isrc": info.isrc,
        "duration": round(duration, 3),
        "original_file": f"original{src.suffix.lower()}",
        **analysis,
        "vocal_range": melody["range"],
        "notes": len(melody["notes"]),
        "lyrics": lyrics_meta,
        "pipeline": {"version": __version__, "separation_model": stems.model, "pitch_model": f"crepe-{crepe_model}", "timings_s": timings},
    }
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="karaoke-pipeline", description="Build karaoke song bundles from audio files you own.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("process", help="process a file or a folder of audio files")
    p.add_argument("input", type=Path)
    p.add_argument("-o", "--library", type=Path, default=Path("library"), help="output library folder (default: ./library)")
    p.add_argument("--model", default="htdemucs", choices=["htdemucs", "htdemucs_ft", "htdemucs_6s"], help="separation model")
    p.add_argument("--crepe-model", default="full", choices=["full", "tiny"], help="pitch tracker size")
    p.add_argument("--skip-lyrics", action="store_true", help="don't look up lyrics online")
    p.add_argument("--force", action="store_true", help="reprocess songs that already have a bundle")
    w = sub.add_parser("worker", help="process uploads from the SoundCheck cloud queue (needs SUPABASE_URL + SUPABASE_SECRET_KEY)")
    w.add_argument("--once", action="store_true", help="process at most one job, then exit")
    w.add_argument("--model", default="htdemucs", choices=["htdemucs", "htdemucs_ft", "htdemucs_6s"])
    w.add_argument("--crepe-model", default="full", choices=["full", "tiny"])
    args = parser.parse_args(argv)

    if args.command == "worker":
        from .worker import run
        n = run(once=args.once, model=args.model, crepe_model=args.crepe_model)
        print(f"processed {n} job(s)")
        return 0

    inputs = find_inputs(args.input)
    if not inputs:
        print(f"no audio files found in {args.input}", file=sys.stderr)
        return 1
    args.library.mkdir(parents=True, exist_ok=True)
    failures = 0
    for i, src in enumerate(inputs, 1):
        print(f"[{i}/{len(inputs)}] {src.name}")
        try:
            out = process_file(src, args.library, model=args.model, crepe_model=args.crepe_model,
                               skip_lyrics=args.skip_lyrics, force=args.force)
            print(f"  -> {out}")
        except Exception as e:
            failures += 1
            print(f"  FAILED: {e}", file=sys.stderr)
    print(f"done: {len(inputs) - failures} ok, {failures} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
