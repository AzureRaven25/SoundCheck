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

## Cloud worker (SoundCheck M4)

`karaoke-pipeline worker` consumes the Supabase `audio_processing` queue. For each upload it:
1. downloads the original from Storage;
2. separates the stems (HTDemucs);
3. extracts the melody (CREPE), then splits repeated notes at vocal onsets;
4. word-aligns the lyrics (torchaudio MMS forced aligner on the vocal stem, line by line);
5. detects key and tempo;
6. uploads the stems and pitch contour to `audio/<owner>/<track>/<asset>/`;
7. writes the `audio_assets` stems, `karaoke_analysis` and word-timed `lyrics` rows.

It needs only `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (service-role RPCs, no DB password). A 27 s song processes in about 19 s on an M5.

```bash
SUPABASE_URL=... SUPABASE_SECRET_KEY=... uv run karaoke-pipeline worker      # loop
uv run karaoke-pipeline worker --once                                        # one job
```

Deploy on a GPU host with the `Dockerfile`, or to Modal with `modal_app.py`, which scales to zero.

Tests:
- `uv run pytest`: unit tests, plus a macOS-only end-to-end run on a sung TTS test song with separation SI-SDR > 12 dB and word alignment.
- `tests/test_worker_e2e.py`: upload → worker → assets, against the local Supabase stack.
