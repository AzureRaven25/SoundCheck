# Phase 2: Technical Research

Legend: **✅ confirmed** (official docs, source code, or verified locally), **⚠️ unverified** (secondary sources, still needs a test).

## 1. Music providers

SoundCheck separates five capabilities: **search**, **metadata**, **artwork**, **lyrics**, **playable audio**. Having metadata for a song never implies the right to stream it.

| Lead | What it actually is | Search / metadata | Audio | Verdict |
|---|---|---|---|---|
| music.youtube.com | Google streaming service | No public API; the YouTube Data API is for video, not music catalogs | ToS forbid downloading/modifying audio | ❌ Not integrated |
| lucida.to, doubledouble.top | Web front-ends that rip tracks from Qobuz/Tidal/Deezer/Amazon using shared accounts | n/a | Circumvents streaming DRM/access controls | ❌ Not integrated (DRM/ToS circumvention) |
| monochrome.st, antra (hoshi.cfd) | Third-party Tidal/streaming download front-ends | n/a | Same issue | ❌ Not integrated |
| redacted.sh, orpheus.network | Private music BitTorrent trackers | n/a | Unlicensed distribution | ❌ Not integrated |
| new-team.org | Couldn't confirm a music-catalog function or API | n/a | n/a | ❌ No usable capability found |
| artistgrid.cx | Community tracker of unreleased/leaked songs | Leak metadata only | Unlicensed | ❌ Not integrated |
| lidarr.audio | Open-source (GPL) music-collection manager. Its metadata comes from MusicBrainz via the SkyHook proxy; downloads via torrent/Usenet indexers | Uses MusicBrainz, which we use directly | Downloader role not used | ❌ Not integrated; ✅ same metadata source |
| betterlyrics.org | Browser extension adding synced lyrics to YouTube Music; aggregates other providers | No documented public API | n/a | ❌ Not integrated; ✅ we go to its upstreams (LRCLIB) directly |
| limusic.app | Couldn't verify a public API or licensing terms | n/a | n/a | ⚠️ Not integrated; revisit if docs appear |

**Adopted providers**
- **Metadata & search:** MusicBrainz ✅. Core data is CC0. Full dumps are available, and the web service allows 1 request/s with a meaningful User-Agent. Used as a bulk-imported subset plus an on-demand lookup for the long tail.
- **Playable audio:**
  - *User-owned uploads*: personal library, private Storage per user ✅.
  - *Licensed karaoke catalogs* (Singa via MassiveMusic, KaraFun/Recisio, Stingray Karaoke API): need a B2B contract. A provider interface is ready for them.
  - *30-second previews* (iTunes Search API `previewUrl`) ✅. Usable only as preview playback with an Apple Music link-back, never for karaoke processing.
- **Apple Music / Spotify:** MusicKit plays the full catalog on tvOS/iOS, but audio buffers are not accessible (DRM), per Apple engineers on the developer forums ⚠️. So no vocal removal, key change or scoring is possible on those streams. Possible later: a "Listen in Apple Music" deep link.

### Popularity ranking
Raw release counts are polluted. Placeholder recordings ("[silence]", "[untitled]") and spam/noise projects that re-release one track thousands of times topped the list. The ranking now uses:
- `3 × (distinct release groups credited to other artists, i.e. compilations and soundtracks)`;
- `+ min(own release groups, 5)`;
- after excluding bracketed placeholder titles and MusicBrainz's special artists (`[no artist]`, `[unknown]`, Various Artists).

The top of the list is now classic karaoke material: *When a Man Loves a Woman*, *Stand by Me*, *I Will Survive*, *The Final Countdown*, …

## 2. Artwork providers

| Provider | Mechanism | Terms / restrictions | Verdict |
|---|---|---|---|
| **COV** (covers.musichoarders.xyz) | Search UI across Apple, Deezer, Spotify, Qobuz, Bandcamp and more. Integration via URL query params, a local "integration tool", or a postMessage "remote protocol" | Its own docs ✅: *"Use of the internal API is not condoned"*. *"Integrations must not be used for fully automating the process of obtaining artwork."* Integrations *"must open the official covers website in any compatible web view and let the user interact with it"* and *"must include visible text mentioning that they are using this project, also including its full web address."* | ✅ **Manual "Find better artwork" picker only** (web): opens COV pre-filled with artist/album, the user picks, we store the picked URL, with visible COV credit. Never used for automated fetching |
| **SpotifyArt** (MIT, Astro) | `getCover.ts` fetches `open.spotify.com/embed/<path>`, parses the page's `__NEXT_DATA__` JSON and returns `visualIdentity.image` URLs ✅ (source read) | That's scraping Spotify's embed page; Spotify's Developer Terms prohibit scraping. The MIT code license doesn't grant rights to Spotify's images | ❌ Approach not reused. ✅ Legitimate equivalent: when a user pastes a Spotify link, call Spotify's documented **oEmbed** endpoint (`open.spotify.com/oembed?url=`), which returns `thumbnail_url` |
| **Cover Art Archive** | `coverartarchive.org/release-group/{mbid}/front-{250,500,1200}` and full size ✅ | Free API, hotlinking allowed. Images remain © their owners | ✅ **Primary automatic provider** (keyed by MBID, no fuzzy matching) |
| **iTunes Search API** | `itunes.apple.com/search`; `artworkUrl100` can be rewritten to `{N}x{N}bb.jpg` up to about 3000 px ⚠️ | Apple's terms expect use alongside promotion/links to Apple content. Rate-limited (~20 req/min) ⚠️ | ✅ **Secondary automatic provider** (match by artist+album, checked against duration/track count), cached |
| Deezer API | `api.deezer.com/search/album`, `cover_xl` (1000 px) | Deezer API terms limit commercial use ⚠️ | ⏸ Optional third fallback, off by default |

The pipeline:
1. Ask providers in priority order.
2. Validate each image (fetch, check it's square-ish and ≥ 500 px, compute a perceptual hash for duplicate detection).
3. Cache it in the public `artwork` bucket in two derived sizes (WebP 300 px for lists, 1200 px for TV/now-playing), with the original URL kept as provenance.
4. Fall back to a generated gradient placeholder.

Artwork never blocks catalog display or playback.

## 3. Vocal separation

| Model | Vocal SDR (MUSDB18-HQ) | License | Notes |
|---|---|---|---|
| HTDemucs / htdemucs_ft | ~8–9 dB | Code MIT ✅ | Runs today in `services/pipeline`. M5 Apple GPU: ~6 s per 9 s clip, ~1–2 min per song ✅ (measured) |
| BS-RoFormer / Mel-Band RoFormer (UVR community weights) | ~11–12 dB ⚠️ | Weights' licenses vary per checkpoint ⚠️ | Best quality today; evaluate via `audio-separator` (MIT) |
| MDX-Net (UVR) | ~9–10 dB ⚠️ | Mixed ⚠️ | Fast |
| Spleeter | ~6 dB | MIT | Fast but too lossy |
| Open-Unmix | ~6 dB | MIT | Baseline only |

**Decision:** keep `htdemucs_ft` as the default because its license is clear. Add a RoFormer option behind a feature flag once each checkpoint's license is verified. Process **before playback, cached forever**: the first request queues a job (about 1–2 min), and popular songs get pre-processed in the background. GPU workers run off-Supabase (§9).

## 4. Pitch detection & scoring

- **Reference (offline):** torchcrepe `full` (MIT) ✅ on the vocal stem; it handles residual bleed. RMVPE is reportedly more robust on polyphonic vocals ⚠️, so evaluate it as a drop-in.
- **Live (on the phone):** YIN/MPM over 2048-sample windows with a 10 ms hop, in an AudioWorklet (web), AVAudioEngine tap (iOS) or AudioRecord (Android). Cheap, and accurate enough for a monophonic close-mic voice.
- The methodology is specified in [SCORING.md](SCORING.md).

## 5. Lyrics

- **LRCLIB** ✅: free, no API key, line-level LRC (sometimes enhanced word-level LRC). It's community-sourced with no explicit commercial-display license, so it's fine for development and personal use. For a public launch, license lyrics from **Musixmatch** (full text + word-level "richsync" on paid tiers) or **LyricFind**.
- **Word-level timing when missing:** forced alignment of the line text against the isolated vocal stem with **torchaudio MMS_FA** (multilingual wav2vec2 aligner) ✅. It only runs inside each line's time window. Fallback: distribute words across the melody note onsets in that line.
- Stored as JSON: `lines[{start,end,text,words[{start,end,text}]}]`, plus a `granularity` field.

## 6. Key transposition

| Platform | Engine | Notes |
|---|---|---|
| Web | **signalsmith-stretch** (MIT, JS/WASM, AudioWorklet) ✅ npm 1.3.2 | Better quality than SoundTouch (LGPL), which the old prototype used |
| tvOS / iOS | `AVAudioEngine` + `AVAudioUnitTimePitch` (`pitch` in cents) ✅ in the tvOS 27 SDK headers (tvOS 9+) | Applied to both stems so the guide vocal follows |
| Fire TV / Android | Media3 `PlaybackParameters(speed = 1f, pitch = 2^(n/12))` (Sonic) | Lower quality than Rubber Band; an NDK Signalsmith `AudioProcessor` is the quality upgrade path |
| Cloud fallback | Pre-render shifted stems with Rubber Band (GPL is fine server-side) | For very weak devices |

Scoring and the pitch bar shift the reference notes by the same number of semitones.

## 7. Smartphones as microphones

- **tvOS facts:** no app microphone input on Apple TV, and no official WebRTC SDK for tvOS ⚠️. A design that streams raw audio *to the TV* would need a custom libwebrtc build or a custom UDP/Opus stack on tvOS.
- **Decision v1, pitch-on-phone:** each phone computes pitch and loudness locally at 100 Hz. It sends **batched frames** (10 per message, so 10 msgs/s) over **Supabase Realtime Broadcast** on a private channel `session:<id>`. That's 4 singers × 10 = 40 msgs/s, well within the free plan's 100 msg/s ✅ (Realtime limits doc).
- **Why this design:**
  - It works identically for Apple TV, Fire TV and the web.
  - It tolerates bad Wi-Fi and even cellular.
  - Bandwidth is tiny.
  - No feedback loop is possible, because the TV never plays the voice.
  - Scoring is unaffected by network jitter, since frames are timestamped in song time.
- **Clock sync:** the TV broadcasts transport events (`play` with the song position and wall-clock time), and phones align using NTP-style round-trip pings over the channel.
- **Echo/feedback:** phone mics hear the TV's instrumental. Mitigations:
  - Platform voice processing: `echoCancellation` + `noiseSuppression` in getUserMedia, iOS `.voiceChat` mode, Android `VOICE_COMMUNICATION` + `AcousticEchoCanceler`.
  - Calibration at join: measure the room noise floor while the TV plays a test segment, then set a voice gate 10 dB above it.
  - A confidence threshold on pitch.
  - Scoring warns when the guide vocal is above 30%, because the mic would pick it up.
- **Phase 2 ("hear yourself" through the TV):** low-latency voice return via WebRTC to the web TV and Fire TV, and a Network.framework UDP/Opus receiver on tvOS. This is optional, since acoustic monitoring in a room is usually enough.

## 8. Platform technology

| App | Stack | Key libraries |
|---|---|---|
| Website | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind | `@supabase/ssr` + `supabase-js` 2.119 ✅, Web Audio + AudioWorklet, Media Session API, `signalsmith-stretch`, QR |
| Apple TV | Swift 6, SwiftUI, tvOS 17+ | `supabase-swift` (tvOS 16+ ✅), AVFoundation/AVAudioEngine, CoreImage `CIQRCodeGenerator` ✅ |
| iOS | Swift 6, SwiftUI, iOS 17+ | `supabase-swift`, AVAudioEngine input tap (`.voiceChat`), VisionKit `DataScannerViewController` for QR |
| Fire TV | Kotlin, Jetpack Compose for TV (`androidx.tv:tv-material`), Media3 ExoPlayer; minSdk 28 (Fire OS 7 = Android 9) | `supabase-kt` (Kotlin Multiplatform) ⚠️ check version at integration |
| Android | Kotlin, Compose Material 3, CameraX + ML Kit barcode (bundled model, no Google Play Services, so it works on all phones) | `supabase-kt`, AudioRecord |

Shared code:
- One Swift package (`SoundCheckKit`) for tvOS + iOS.
- One Gradle `:core` module for Fire TV + Android.
- One TypeScript package for web + Edge Functions.
- Cross-language behaviour (lyric timing, scoring HUD) is pinned by shared JSON **golden fixtures** that all three test suites run.

## 9. Cloud infrastructure

| Workload | Choice | Why / alternatives |
|---|---|---|
| Database, Auth, Realtime, light API | **Supabase** (existing project) | Required; RLS everywhere |
| Job queue | **pgmq** inside Supabase ✅ (available) | No extra service; alternatives were SQS or Cloud Tasks |
| Light server logic | Supabase Edge Functions (Deno): pairing, artwork/lyrics resolve, score finalisation | Short CPU-bound tasks only |
| GPU processing | **Modal** (serverless GPU, per-second billing, Python-native). Alternatives: RunPod serverless, AWS Batch on g6, Cloud Run with L4 GPUs | Scales to zero; ~$0.01–0.03 per song on an L4/A10G ⚠️. Needs your account (§ blocked items) |
| Dev worker | The same worker code on the Mac (Apple GPU) pulling from the cloud queue and writing to cloud Storage | Persistent data stays in the cloud; local files are temporary |
| Asset storage | Supabase Storage (`audio` private, signed URLs; `artwork` public) | S3/R2 as an option when volume grows (R2 has no egress fees) |
| Catalog scale | Supabase Free = 500 MB database. The full ranked list is **26.5 M songs** (built locally in ~6 min by `ranked_subset.sql`) | **Tiered catalog:** Supabase holds the active catalog (top-ranked songs plus every song a user touches). **Turso** (libSQL, `soundcheck` database in aws-us-east-1) holds a read-only FTS5 index of the long tail. `catalog-search` falls back Supabase → Turso → MusicBrainz live; picking a long-tail song copies it into Supabase. Turso can't hold user data, because foreign keys/RLS between songs and playlists/scores need one Postgres |

### Needs your input (blocking only those parts)
1. **GPU worker hosting:** create a Modal (or RunPod) account; it needs a payment method. Until then the dev worker runs on the Mac.
2. **Supabase plan:** Free covers development (500 MB DB, 1 GB Storage). Processed audio, at about 10 MB per song for 3 stems, needs **Pro ($25/mo)** past roughly 100 songs.
3. **Apple Developer Program** ($99/yr): only needed to run on a physical Apple TV/iPhone. Simulators work without it.
