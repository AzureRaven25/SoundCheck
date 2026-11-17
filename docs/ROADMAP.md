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
M0 ✅ → M1 ✅ → M2 ✅ → M3 ✅ website → **M4 ✅ processing worker (2026-11-17)** → **M5 ✅ SoundCheck Stage + Party on web (2026-11-17)** → **M6 in progress** (Apple TV + iOS).

M5 delivered:
- Solo Stage: stems, guide-vocal slider, key shift, word wipe, live pitch HUD, official score. E2E score: 66 on a partial take.
- Party mode: the TV opens a session with a QR code and pairing code. Phones join at `/join/<code>` as anonymous users and stream pitch over a private Realtime channel. The TV shows a live trail and on-pitch chip per singer and broadcasts live scores and final results to each phone.
- Playwright multi-context test: TV + 2 phones with fake mics. Phone clock drift measured at 1 ms; both singers scored 84 over the full song.
- Phones follow the TV's audio clock: the 2 s transport heartbeat is re-anchored to the real playback position.
- Singer colours are race-free: the session row is locked and each singer gets the first unused palette colour.

M6 so far (2026-11-17):
- SoundCheckKit Swift package (protocol, clock sync, vDSP YIN, Supabase, Realtime, AVAudioEngine stems with key shift, shared SwiftUI).
- SoundCheckTV (tvOS 18) and SoundCheckMobile (iOS 18). Build with `cd apps/apple && xcodegen`.
- Verified in simulators:
  - The TV hosts with a web phone singing: live 100% on pitch, score 83.
  - The TV hosts with the native iPhone: joined by `soundcheck://join/CODE` link, mic permission, live lyric sync, official score shown on the phone.
- Still to do:
  - Device-code sign-in on the TV (it currently uses an email form).
  - Solo singing on iPhone.
  - XCUITests.
  - Physical-device runs; these need your Apple Developer account.

M7 so far (2026-11-17):
- `apps/android` (Gradle; build with `./gradlew :tv:assembleDebug :mobile:assembleDebug`).
  - `:core` is plain Kotlin: protocol, clock sync, timing, YIN, a smoothed playback clock, supabase-kt backend and Realtime party host/guest. 10 JVM tests, run against the same golden fixtures as the other clients.
  - `:tv` (Fire TV / Android TV, Compose for TV + Media3): browse, search, preview, account, and Stage party host with QR code.
  - `:mobile` (Android phone): join by code or `soundcheck://join/CODE` link; AudioRecord mic with echo cancellation.
- Verified on emulators:
  - Fire TV hosting a web phone scored 83, the same as Apple TV.
  - Native Android phone with Fire TV: deep link, mic, lyric sync, and the score card delivered to the phone.
- Found on the emulator: ExoPlayer's playback position jitters ±150 ms, and the audio runs about 3% slow. A smoothed clock plus a 40 ms re-anchor threshold keeps phones steady.
- Still to do:
  - Real Fire TV run (needs ADB debugging on).
  - Google Play / Amazon Appstore packaging.
  - Solo singing on the phone.
  - UI tests.

M8 + polish (2026-11-17):
- **Live site:** https://soundcheck-gules.vercel.app (Vercel; builds from the repo root with `apps/web` as the root directory).
  - Cloud auth: site URL and redirects set, anonymous sign-ins on. Email confirmation and TOTP MFA stay on through `[remotes.production]` overrides in `supabase/config.toml`.
- **Party queue:** phones request songs from `/join`. The host sees "Up next", and "Sing next" continues the same session (`?party=<id>`) so phones stay joined. New `queue_changed` protocol event.
- **Social:**
  - `/friends`: find people, send/accept requests.
  - `/leaderboards`: global and friends boards, plus your stats.
  - `/achievements`: all badges with progress; three new badges.
  - Badges a song unlocks show on its results screen.
- **TV sign-in with your phone:** the `device-auth` Edge Function plus the `/activate` page, in both TV apps. The device code is stored hashed, expires in 10 minutes, and works once.
- **Solo singing on iPhone and Android phones:** "Sing solo" tab, phone playback + mic, official score.
- **UI tests:**
  - Web: Playwright social, device-sign-in and party-queue tests.
  - iOS: XCUITest (join form, solo tab).
  - Android: Compose instrumented tests (join form, deep links, solo tab).
  - Database: 20 new pgTAP tests (88 total).
- **Bugs fixed:**
  - iOS code field didn't clean what you typed.
  - The "ABC123" placeholder wasn't a valid code (codes never use 0, 1, I or O).
  - Android solo crashed because the mic thread touched the player; it now reads a snapshot.
- **Not yet:** native TV apps don't show the party queue yet (web host only).

M2 delivered:
- 100,000 top-ranked songs in Supabase (218 MB);
- tiered `catalog-search` (Supabase → Turso → MusicBrainz live);
- blended typo-tolerant ranking;
- `resolve-artwork` (Cover Art Archive → iTunes);
- `fetch-lyrics` (LRCLIB, word-level when available);
- provider cache + global throttle.

M2 leftovers:
- ~~Turso export~~ ✅ live: ranks 100,001–1,000,000 in Turso. Function secrets are set and cloud promotion is verified.
- Copying artwork into Storage (resized WebP + perceptual hash) is deferred to M3, when the web image pipeline exists. Provider URLs are stable CDN links meanwhile.
- MusicBrainz contact string for the User-Agent (`PROVIDER_CONTACT` function secret).
- Search latency for very short words (~1.5 s) needs tuning.

## Blocked on you (independent work continues)
- GPU host account (Modal or RunPod) for cloud processing: M4 deploy step.
- Supabase Pro, once processed audio exceeds about 1 GB.
- Apple Developer account, for physical Apple TV/iPhone testing.
- Fire TV ADB debugging turned on, for physical Fire TV testing.
- Auth providers (Sign in with Apple / Google): need OAuth client IDs from your Apple/Google developer accounts.
