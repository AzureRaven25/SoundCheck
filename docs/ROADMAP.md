# Phase 5: Development Roadmap

Ordered by dependency: the shared foundation comes first, then the platforms. Milestones marked ∥ can run in parallel once their dependencies land.

| # | Milestone | Platforms | Depends on | Deliverables | Tests |
|---|---|---|---|---|---|
| **M0** | Assessment, research, architecture | all | — | `docs/*` | — |
| **M1** | **Supabase foundation** | backend | M0 | Migrations: catalog, users, karaoke, social, processing; RLS on every table; RPCs (`create_session`, `join_session`, `request_processing`, leaderboards); storage buckets + policies; profile trigger; pgmq queue; generated TS types | pgTAP suite: schema, RLS per role (anon / user / other user / service), RPC behaviour; pushed to cloud and verified remotely |
| **M2** | Cloud catalog | backend | M1 | Ranked MusicBrainz subset synced to Supabase; `catalog-search` Edge Function with MusicBrainz live fallback; artwork resolver (CAA → iTunes) with Storage cache; LRCLIB lyrics function | Function unit tests (mocked HTTP), live smoke tests, size budget check |
| **M3** | Website core | web | M1, M2 | Next.js app: auth (email + magic link, Apple/Google later), profile/settings, home, search, artist/album/track pages, player (queue, shuffle, repeat, Media Session), playlists, favorites, history, uploads | Vitest unit, Playwright E2E against local Supabase |
| **M4** | Processing pipeline v2 ∥ M3 | backend/worker | M1 | Worker: pgmq consumer, Storage I/O, word alignment (MMS_FA), phrase detection, onset split of repeated notes, fingerprint dedupe; Modal deployment script | pytest with real short CC-licensed audio; end-to-end job test against local Supabase |
| **M5** | **SoundCheck Stage on web** | web, phones (browser) | M3, M4 | Karaoke player (stems, guide slider, signalsmith key shift, word highlighting, pitch HUD); sessions + QR pairing; `/join` browser mic (pitch worklet, calibration); `@soundcheck/scoring` + `score-performance` function; results screen | Scoring golden fixtures; Playwright multi-context session test (host + 2 fake mics) |
| **M6** | Apple apps ∥ M7 | Apple TV, iOS | M1, M2, M5 protocol | SoundCheckKit; tvOS: auth (device code), browse, search, artist/album, playback, Stage, QR, multi-singer HUD, results; iOS: scan/join, mic + calibration, results, library | XCTest (kit + golden fixtures), XCUITest on simulators |
| **M7** | Android apps ∥ M6 | Fire TV, Android | M1, M2, M5 protocol | `:core`; Fire TV (Compose TV + Media3); Android mobile (CameraX/ML Kit, AudioRecord mic) | JUnit (core + fixtures), Compose UI tests on TV and phone emulators |
| **M8** | Party & social | all | M5–M7 | Singer queues, friends, friend/global leaderboards, achievements & badges, session invites, recommendations | DB tests for leaderboards/achievement triggers; E2E |
| **M9** | Hardening & launch readiness | all | all | Sentry monitoring, CI (GitHub Actions; you push), performance budgets, accessibility, physical-device verification checklist, licensed-content provider integration | Device matrix sign-off |

## Current focus
M0 ✅ → M1 ✅ → **M2 ✅ (2026-11-16)** → **M3 next** (website), M4 in parallel.

M2 delivered:
- 100,000 top-ranked songs in Supabase (218 MB);
- tiered `catalog-search` (Supabase → Turso → MusicBrainz live);
- blended typo-tolerant ranking;
- `resolve-artwork` (Cover Art Archive → iTunes);
- `fetch-lyrics` (LRCLIB, word-level when available);
- provider cache + global throttle.

M2 leftovers:
- Turso export runs once `TURSO_AUTH_TOKEN` is set.
- Copying artwork into Storage (resized WebP + perceptual hash) is deferred to M3, when the web image pipeline exists. Provider URLs are stable CDN links meanwhile.
- MusicBrainz contact string for the User-Agent (`PROVIDER_CONTACT` function secret).
- Search latency for very short words (~1.5 s) needs tuning.

## Blocked on you (independent work continues)
- GPU host account (Modal or RunPod) for cloud processing: M4 deploy step.
- Supabase Pro, once processed audio exceeds about 1 GB.
- Apple Developer account, for physical Apple TV/iPhone testing.
- Fire TV ADB debugging turned on, for physical Fire TV testing.
- Auth providers (Sign in with Apple / Google): need OAuth client IDs from your Apple/Google developer accounts.
