# karaoke-pipeline

Offline processing that turns audio files **you own** into karaoke song bundles. This is Phase 0, spike 1 in [docs/PLAN.md](../../docs/PLAN.md).

## Setup (macOS, Apple Silicon)

```bash
brew install uv ffmpeg
cd services/pipeline
uv sync
```

## Usage

```bash
uv run karaoke-pipeline process ~/Music/karaoke-test -o library
```

Arguments:
- The input can be one file or a folder (searched recursively). Supported formats: MP3, FLAC, M4A/ALAC, WAV, AIFF, OGG, Opus.
- Title, artist and album come from the file's tags, falling back to `Artist - Title.ext` filenames. Tag your files properly (for example with MusicBrainz Picard) so the lyrics lookup finds them.
- Songs that already have a bundle are skipped. Use `--force` to reprocess them.
- Options: `--model htdemucs_ft` (about 4x slower, slightly cleaner separation), `--crepe-model tiny` (faster, rougher pitch), `--skip-lyrics`.

The first run downloads the HTDemucs weights (about 80 MB) from Meta's servers.

## Output: one folder per song

| File | What it is | Used for |
|---|---|---|
| `original.<ext>` | Byte-for-byte copy of the input | **Original mode** (exactly as released) |
| `instrumental.m4a` | Everything except the vocals (AAC 256k) | **Karaoke mode** |
| `vocals.m4a` | Isolated vocals | **Guide-vocal slider** |
| `melody.json` | 10 ms pitch contour (MIDI, `null` = silent) and a note list `{start, end, pitch}` | Scoring and the on-screen pitch bar |
| `lyrics.json` | Synced lines `{start, end, text}` from LRCLIB | Lyrics display |
| `meta.json` | Title/artist, key, tempo, vocal range (`low`/`high` = 5th–95th percentile MIDI note), per-step timings | Library, key suggestions |

## Performance (M5, 32 GB)

On a 9-second synthetic test clip: separation took about 6 s and pitch tracking about 6 s, both on the Apple GPU (MPS). Expect roughly 1–2 minutes per 4-minute song. Pitch tracking on the CPU is about 14x slower, which is why the GPU is the default.

## What to judge with real songs

1. **Separation:** does `instrumental.m4a` still have vocal bleed, especially reverb tails and backing vocals?
2. **Melody:** do the notes in `melody.json` match the sung melody? Known artifact: big pitch jumps and fade-outs can leave short stray notes.
3. **Lyrics:** do LRCLIB's line timings line up with the vocals? Timing is line-level for now; word-level alignment (WhisperX) is the next step.

## Tests

```bash
uv run pytest
```
