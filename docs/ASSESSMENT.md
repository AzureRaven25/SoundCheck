# Phase 1: Repository & Environment Assessment

*Assessed 2026-11-16, at the restart of the project as **SoundCheck**.*

## Repository contents (before the restart)

| Path | Tech | What it does | Status | Decision |
|---|---|---|---|---|
| `services/pipeline` | Python 3.12, HTDemucs, torchcrepe, librosa, LRCLIB | Turns an owned audio file into a song bundle: original copy, vocal + instrumental stems (AAC), reference melody (10 ms contour + notes), line-synced lyrics, key/tempo, vocal range | Works; 9 unit tests pass; ~20 s per minute of audio on Apple-GPU | **Keep.** Becomes the GPU worker core (Milestone 4): add a Supabase queue consumer, Storage uploads, word alignment, phrase segmentation |
| `services/catalog` | Python, Postgres 17 | Imports the MusicBrainz full dump into a song-level catalog (eligibility rules, remaster grouping, ISRCs), with search and library linking | Works on fixtures (14 tests); the real import into **local** Postgres is still running | **Keep the importer logic**, retarget it: local Postgres becomes a staging area only, and a filtered subset syncs to Supabase (M2). Persistent data must not live on the Mac |
| `services/api` | FastAPI | HTTP API over the local catalog and bundles | Works (3 tests) | **Retire** once Supabase (PostgREST + RPC + Edge Functions + Storage) covers it (M2/M3) |
| `apps/tv` | Expo + react-native-tvos | Home/Search/Song/Player UI, web spatial navigation, SoundTouch key change, lyrics wipe, pitch bar | Verified in the browser | **Superseded** by native tvOS (SwiftUI) and Fire TV (Kotlin) apps. Its player logic (lyric timing, sung-end wipe, countdowns, pitch bar) moves to the web app and native ports, then it gets deleted |
| `docs/PLAN.md` | Markdown | Original plan | Outdated | Replaced by the docs in this folder |

### Technical debt / known issues carried over
- Repeated same-pitch notes merge into one note in `melody.json` (needs onset detection).
- Key detection confuses relative major/minor.
- Lyrics are line-level only.
- Synthetic test audio can't exercise Demucs; real recordings are needed.
- The catalog importer's grouping query is slow (a large `count(DISTINCT)` aggregation). It needs restructuring before routine re-imports.
- There is no auth anywhere; everything assumes a single local user.

## Environment

| Item | Found |
|---|---|
| Machine | Apple M5, 32 GB RAM, macOS (Darwin 25.6) |
| Xcode | Installed, with **tvOS 27 + iOS 27 SDKs** and simulators |
| Android | cmdline-tools via Homebrew (`/opt/homebrew/share/android-commandlinetools`): platform `android-37.0`, build-tools 36, `android-tv` + `android-31` system images, emulator. `ANDROID_HOME` was not set |
| JDK / Gradle | OpenJDK 21, Gradle (Homebrew) |
| Node | v24 |
| Python | 3.14 system; 3.12 via `uv` for ML |
| Supabase CLI | 2.90, logged in |
| Docker | Not installed; colima + Docker CLI installed during this milestone for the local Supabase stack |

## Supabase project `SoundCheck` (ref `ppmzqjrfcbemzzbwicrd`, us-east-1)
Inspected read-only through the CLI:

- **Schemas:** only the Supabase defaults (`auth`, `storage`, `realtime`, `vault`, `graphql*`, `extensions`, `public`). The `public` schema has **no tables**.
- **Migrations:** none.
- **Storage buckets:** none.
- **Auth users:** 0.
- **Extensions installed:** `pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `supabase_vault`.
- **Extensions available:** `pg_trgm`, `unaccent`, `pgmq` (queues), `pg_cron`, `pg_net`, `vector`.

Conclusion: a clean project. Nothing to preserve, migrate or deduplicate, and no destructive operations are needed.
