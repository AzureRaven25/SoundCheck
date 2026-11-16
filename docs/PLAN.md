# KaraokeApp: Product & Technical Plan

> Status: draft v1 (2026-11-15). Living document. Update it as decisions get made.

## 1. Vision

The best karaoke experience for the living room. It runs on Apple TV and Fire TV, everyone's phone works as a mic with no extra hardware, you can sing any song in any key, and it looks good enough that people choose it for parties.

Core pillars (from the brainstorm):

1. **Huge catalog**: the songs people actually want to sing.
2. **Original mode**: hear the song exactly as released.
3. **Karaoke mode**: vocals removed, everything else intact, with a *guide vocal* slider from 0% to 100%.
4. **Lyrics for every song**: synced line by line and ideally word by word.
5. **Phones as mics**: iPhone or Android, no app install needed to join.
6. **Scoring**: compare the singer to the original vocal and show a score at the end.
7. **Key change**: transpose up or down so anyone can sing anything.
8. **Great design**: TV-first, 10-foot UI, party-ready.

---

## 2. The hard truth first: where the songs come from

This is the decision that shapes everything else, so it comes first.

### What we *cannot* do
- **Spotify**: there is no SDK for tvOS or Fire TV that hands us audio, and the platform terms forbid apps that *alter* Spotify content. Vocal removal counts as altering it. Spotify's own vocal-reduction karaoke exists only in Japan, through a licensing partnership with Joysound.
- **Apple Music (MusicKit)**: MusicKit *can* play the full Apple Music catalog on tvOS, but playback happens outside our app's audio graph. Apple engineers have said on the developer forums that raw audio buffers are not accessible, because of DRM contracts. So we cannot remove vocals, transpose, or score against Apple Music streams. Apple Music Sing does this, but only inside Apple's own app.
- **YouTube**: the terms of service prohibit downloading or modifying audio.

To remove vocals or shift the key, we need the actual audio file, and a legal right to modify and display it. The major labels license that right (master + publishing + lyrics/sync) to karaoke companies under specific deals. A solo developer will not get those deals at the start.

### What we *can* do (layered strategy)

| Layer | Source | Original mode | Karaoke mode / key / scoring | Legal for public release? |
|---|---|---|---|---|
| **A. Own library (MVP)** | Audio files you own (purchased MP3/FLAC/ALAC) and upload to *your* account | ✅ | ✅ (we generate stems) | Personal use only. Fine for building, testing, a portfolio, and home parties. **Not** distributable as a public catalog. |
| **B. Licensed karaoke catalog** | B2B partner: **Singa** (Warner + Merlin original-master deals), **KaraFun/Recisio** (says "we offer an API"), **Stingray Karaoke API** (public docs) | Partly (some catalogs include original masters) | ✅ (they provide backing tracks, often with stems) | ✅ with a contract and revenue share |
| **C. Streaming "Listen" link-out** | Apple Music via MusicKit (tvOS) | ✅ full catalog | ❌ | ✅ (needs the user's Apple Music subscription) |

**Recommendation:** build on Layer A with a clean `ContentProvider` abstraction, so the app never assumes where audio comes from. Prove the experience works end to end. Then approach Layer B partners with a working, beautiful demo, which is the realistic way to get to "every song." Layer C is an optional nice-to-have for original mode.

> ⚠️ If this ever ships publicly, get a music-licensing lawyer involved before launch. Lyrics display also needs its own license (see §4).

---

## 3. Feature list

### MVP (must have)
- Browse and search the library: title, artist, album art, genre, decade.
- Song page: **Listen** (original) vs **Sing** (karaoke).
- **Guide vocal slider** (0–100% original vocal mixed back in).
- **Key change** ±6 semitones, applied in real time without changing tempo.
- **Synced lyrics** with a karaoke-style "wipe" highlight and next-line preview.
- **Phone mic**: scan a QR code on the TV → a web page opens → tap "Mic" → sing.
- **Scoring**: live pitch bar ("note highway") plus an end-of-song score card.
- **Queue**: phones add songs to a shared queue; the TV shows who's up next.

### V1 (what makes it the *best*)
- **Multiple singers**: up to 4 phones at once, each with a color and a score. **Duet mode** splits lyric lines between singers.
- **Vocal range test**: sing a short scale on your phone, and we suggest the best key for every song for *you*.
- **Auto key suggestion** per singer, saved to their profile.
- **Voice effects**: reverb/echo and volume per mic, played through the TV speakers when latency allows (see §5.4).
- **Tempo control** (±20%) for practice.
- **Practice mode**: loop a section, slow it down, solo the guide vocal.
- **Party modes**: battles (head-to-head scores), team mode, "random song roulette", and an applause meter from phone mic levels.
- **Profiles and history**: favorites, past scores, personal bests, "songs that fit your voice".
- **Recording and replay**: save a performance (your voice + backing track) and share a clip.
- **Lyrics extras**: romanization (Japanese/Korean/etc.), translation line, large-text and high-contrast accessibility modes.
- **Visual themes**: animated backgrounds, artist-color theming pulled from album art.
- **Phone remote**: the phone page also works as a full remote (search, queue, skip, pause), so nobody has to fight over the TV remote.

### Later / stretch
- Native phone apps (better audio latency, background mic, haptics).
- Online multiplayer: sing with friends in another house.
- Video backgrounds / music videos where licensed.
- Harmony scoring (backing vocal parts).
- Android TV, Google TV, web, and Fire TV Vega OS (see §6).
- Creator tools: fix lyric timing and share corrections with the community.

---

## 4. Data sources

| Need | Prototype (personal) | Production (licensed) |
|---|---|---|
| **Audio** | User's own files (Layer A) | Karaoke catalog partner (Layer B) |
| **Metadata / art** | MusicBrainz + Cover Art Archive (free, open). Embedded file tags. | Partner metadata, Apple Music API for artwork |
| **Line-synced lyrics** | **LRCLIB** (free, no key, LRC format, community-run; not a licensed catalog) | **Musixmatch API** (licensed; full lyrics and word-level "richsync" on paid tiers; free tier shows only ~30%) or LyricFind |
| **Word-level timing** | Generate ourselves: forced alignment of the lyrics against the *isolated vocal stem* using WhisperX / wav2vec2 | Musixmatch richsync, or our own alignment |
| **Reference melody (for scoring)** | Generate ourselves: pitch-track the isolated vocal stem (§5.2) | Same, or MIDI melody from the karaoke partner |
| **Song key / BPM** | Generate ourselves (Essentia / librosa) | Same |

---

## 5. How the core tech works

### 5.1 Processing pipeline (server-side, offline, once per song)

TV hardware is too weak to separate stems in real time with good quality. So we do the heavy work **once, on a server**, and the TV only mixes pre-made stems. This is the key architectural decision.

```
upload / ingest audio
   │
   ├─► Stem separation ── HTDemucs (htdemucs_ft) ──► vocals.flac, instrumental.flac
   │                      (optionally 4-stem: drums/bass/other too)
   ├─► Reference melody ── CREPE or pYIN on vocals stem ──► pitch contour → note list (JSON)
   ├─► Lyrics ────────── LRCLIB lookup ──► forced-align with WhisperX on vocals stem ──► word timings
   ├─► Key & BPM ─────── Essentia/librosa
   └─► Package ───────── song bundle: { original, instrumental, vocals, melody.json, lyrics.json, meta.json }
                         encode to AAC/Opus, upload to object storage (Cloudflare R2 / S3)
```

- HTDemucs takes seconds to about a minute per song on a GPU. For personal-library scale, a Mac with Apple Silicon or a cheap cloud GPU job queue is plenty. There is a CoreML port too, if we ever want to process on the device.
- The TV playing **original + instrumental + vocals** stems in sync gives us: original mode (play the original), karaoke mode (instrumental only), and the guide-vocal slider (instrumental + vocals × gain). We play the true original file for original mode, so it is bit-for-bit what the artist released.

### 5.2 Scoring

1. **Reference**: the vocal stem is pitch-tracked offline (CREPE ≈ pYIN accuracy on singing; CREPE handles residual bleed better) and segmented into notes `{start, end, midi_pitch}`.
2. **Live singer pitch**: computed **on the phone** in real time (YIN/MPM in an AudioWorklet, roughly 10 ms frames). The phone sends tiny pitch frames (`t, f0, confidence, rms`) to the TV instead of raw audio. That is bandwidth-cheap, robust over Wi-Fi, and keeps the TV's CPU free.
3. **Compare** each frame to the reference note active at that time:
   - **Pitch accuracy** in cents, *octave-invariant* (people often sing an octave up or down), with a tolerance band (for example ±50 cents for full credit, falling off to ±150).
   - **Timing / rhythm**: note onsets within a tolerance window.
   - **Stability / bonus**: sustained notes, vibrato detection.
   - **Key change aware**: the reference shifts by the same number of semitones as the playback.
   - **Latency-compensated**: the clock offset between phone and TV is measured at join time (§5.4).
4. **Result**: a score out of 100 with sub-scores and a grade, plus a "best moment" highlight. Weighting will be tuned by ear. Research reference: the Interspeech 2025 key-based karaoke scoring paper, and the NUS 2017 work on perceptual singing-quality evaluation.

### 5.3 Key change (pitch shifting)

This happens in real time on the TV, applied to the instrumental (and to the guide vocal).

| Option | License | Notes |
|---|---|---|
| **Signalsmith Stretch** | MIT | Modern, good quality on polyphonic music, header-only C++. **Top pick for a shared C++ core.** |
| Rubber Band | GPL or paid commercial | Best-in-class quality. The GPL is incompatible with App Store distribution, so we'd need the commercial license. |
| `AVAudioUnitTimePitch` | Built into tvOS | Free, zero-dependency fallback on Apple TV |
| SoundTouch | LGPL | Lighter, but known to smear transients on modern music |

Fallback if TV CPUs struggle: pre-render shifted instrumentals server-side on demand and cache them.

### 5.4 Phones as mics

- **Join flow**: the TV shows a QR code + room code → the phone opens `https://<app>/join/ABCD` → **no app install** (a web app using `getUserMedia` + AudioWorklet). This works on iPhone Safari and Android Chrome.
- **Two channels from the phone:**
  1. **Pitch data** (always on): WebSocket/WebRTC data channel → TV. Used for scoring and the live pitch bar.
  2. **Voice audio** (optional, "hear yourself"): WebRTC Opus audio → TV → mixed with reverb into the TV output.
- **The latency reality**: phone → Wi-Fi → TV → HDMI → TV speakers/soundbar typically adds **100–250 ms**. Scoring doesn't care, because we compensate for it. *Hearing yourself* through the speakers with that delay is distracting. Mitigations:
  - Default to **voice monitoring off** in loud party settings (the room is loud and you hear yourself acoustically).
  - Calibrate on join (TV plays a chirp, the phone mic hears it, we measure the round trip).
  - Recommend the TV's "Game mode" or low-latency audio.
  - Later: native phone apps with lower-latency audio paths.
- **Transport**: WebRTC (signaling over our backend WebSocket). The data channel carries pitch; the audio track carries voice. Whether react-native-webrtc works on tvOS and Fire TV needs to be **verified in a spike**. The fallback is a raw WebSocket relay of Opus frames.

---

## 6. Platforms & tech stack

### TV app
Fire TV is now **two OSes**: legacy **Fire OS** (Android-based, most devices) and the new Linux-based **Vega OS** (newer sticks such as the 2026 Fire TV Stick HD and 4K Select), where **React Native is the primary framework** (Vega 2.0 ships React Native 0.83). That makes React Native the natural shared choice:

- **UI**: React Native + TypeScript using `react-native-tvos` (Apple TV + Android TV/Fire OS from one codebase), with focus-based navigation and a 10-foot design system.
- **Audio engine**: a **native module** (JSI / Nitro Modules) wrapping a **shared C++ core** (stem mixer, pitch shifter, scoring math, clock sync).
  - tvOS: AVAudioEngine host + C++ core.
  - Fire OS / Android: Oboe (AAudio) host + same C++ core.
  - Vega OS: later phase. Native modules need porting there, so we keep the C++ core portable.
- Why not fully native (Swift + Kotlin)? It's doable, but it means building the UI twice. RN covers the UI on all three OSes, and the performance-critical part is native anyway.

### Phone (mic + remote)
- **Web app**: React + TypeScript + Vite, deployed as a PWA. AudioWorklet for pitch detection, WebRTC for transport.

### Backend
- **API**: TypeScript (Node, Fastify or Hono) *or* Python (FastAPI). I lean towards **Python/FastAPI**, since the ML pipeline is Python anyway.
- **Realtime / rooms**: WebSocket server for party rooms, queues, and WebRTC signaling.
- **Workers**: Python job queue (Redis + RQ/Celery) running Demucs, CREPE, WhisperX, Essentia on a GPU (local Mac for dev; Modal/RunPod/Replicate for cloud bursts).
- **DB**: Postgres (users, songs, scores, rooms). **Storage**: Cloudflare R2 (cheap egress) or S3.
- **Auth**: Sign in with Apple + Google (plus TV device-code login: "go to app.com/tv, enter code").

### Monorepo layout (proposed)
```
KaraokeApp/
├─ apps/
│  ├─ tv/            # React Native (react-native-tvos): Apple TV + Fire TV
│  └─ phone/         # Web app: mic, remote, queue
├─ packages/
│  ├─ audio-core/    # C++: mixer, pitch shift, scoring, clock sync (+ unit tests)
│  ├─ shared/        # TS types, protocol messages, scoring config
│  └─ ui/            # design tokens, shared components
├─ services/
│  ├─ api/           # FastAPI: catalog, users, rooms, scores
│  └─ pipeline/      # Python: separation, melody, lyrics alignment, packaging
└─ docs/
```

---

## 7. Design direction

- **10-foot UI**: big type, high contrast, everything reachable with the Siri Remote / Fire TV remote D-pad, with a clear focus state (scale + glow).
- **Look**: dark, vibrant, "night out" feel. Album-art-derived color gradients, smooth animated lyrics, a neon-but-tasteful pitch highway.
- **Lyrics screen hierarchy**: current line (huge, wipe highlight) → next line (dimmed) → pitch bar → singer chips with live scores.
- **Phone UI**: one giant mic button, live level meter, "you're up next" notification, queue and search.
- **Score card**: animated reveal, sub-scores, confetti for high scores, "sing again in a better key?" prompt.
- Build a Figma (or code-first) design system early: tokens for color, type, spacing, motion.

---

## 8. Roadmap

### Phase 0: De-risking spikes (≈2–3 weeks)
Each is a throwaway prototype that answers one scary question:
1. **Pipeline**: run HTDemucs + CREPE + LRCLIB + WhisperX on 10 owned songs. *Is the separation and lyric timing good enough?*
2. **TV audio**: a Fire TV app that plays 2 stems in sync with a live guide-vocal slider + Signalsmith key shift. *Does the TV CPU handle it without glitches?*
3. **Phone mic**: a web page streaming pitch + audio to the TV app over WebRTC. *What's the real latency on our hardware? Does react-native-webrtc work on Fire TV?*
4. **Scoring**: an offline script that scores recorded performances against the reference. *Do the scores feel fair?*

### Phase 1: MVP on Fire TV (≈6–8 weeks)
Monorepo, backend + pipeline, library upload, browse/search, original/karaoke modes, guide slider, key change, synced lyrics, one phone mic, scoring, basic queue.

### Phase 2: Apple TV + multiplayer (≈4 weeks)
AVAudioEngine (tvOS) host for the audio core, up to 4 mics, duets, profiles, vocal range test, auto key.

### Phase 3: Polish & party features (≈4+ weeks)
Themes, battles, recording/replay, practice mode, accessibility, performance tuning, TestFlight / Amazon Live App Testing beta.

### Phase 4: Catalog & launch
Approach licensed karaoke catalog partners with the demo, a Musixmatch lyrics license, a legal review, Vega OS port, and App Store / Amazon Appstore submission.

---

## 9. Costs & accounts you'll need

- Apple Developer Program: $99/yr (required to run on a real Apple TV + TestFlight).
- Amazon Developer account: free.
- Hardware: an Apple TV 4K and a Fire TV Stick (ideally one Fire OS and one Vega device eventually).
- GPU processing: a local Apple Silicon Mac is fine for dev; cloud GPU is cents per song.
- Hosting: small for personal use (≈$0–20/mo on free tiers + R2).
- Later: Rubber Band commercial license (only if we choose it), Musixmatch plan, karaoke catalog deal.

---

## 10. Open questions (need your input)

1. ~~**Goal**~~ **Decided (2026-11-15): personal project for now.** We build on Layer A (your own music files). Licensing (Layer B, Musixmatch, legal review) waits until a public launch is on the table, but the `ContentProvider` abstraction keeps that door open.
2. **Decided: Fire TV first.** Phases 1 and 2 swap: the MVP targets Fire TV (Oboe/AAudio host for the C++ core), and Apple TV (AVAudioEngine host) follows in Phase 2 from the same React Native codebase. **Still open:** is the Fire TV device on Fire OS (Android) or Vega OS? That decides between `react-native-tvos` and React Native for Vega for the MVP.
3. **Decided: test hardware** is an Apple TV, a Fire TV device and an iPhone. There's no Android phone, so the phone web app gets tested in iPhone Safari first; Android Chrome can come later via a friend's phone or an emulator.
4. **Decided: languages.** You're comfortable with TypeScript/React, Python, Swift/Kotlin and C++, so the stack in §6 stands as is.
5. **Decided: Python/FastAPI** for the backend.

---

## Sources
- Spotify developer forum, on altering content / vocal removal: https://community.spotify.com/t5/Spotify-for-Developers/Legality-question-Removing-vocals-from-a-track-for-singing-app/td-p/6072869
- Spotify karaoke availability: https://stemsplit.io/blog/spotify-karaoke-mode · https://www.musicradar.com/news/spotify-vocal-removal-karaoke
- MusicKit, no raw audio buffer access: https://developer.apple.com/forums/thread/94329 · https://developer.apple.com/forums/thread/852190 · https://developer.apple.com/forums/thread/843627
- Karaoke licensing / B2B: https://www.musicbusinessworldwide.com/warner-music-strikes-licensing-deal-with-karaoke-startup-singa/ · https://merlinnetwork.org/merlin-and-singa-ink-partnership-to-bring-thousands-of-original-recordings-to-karaoke/ · https://recisio.com · https://karaoke-api-doc.stingray.com/docs/introduction/design-guidelines · https://massivemusic.com/cases/singa
- Lyrics: https://lrclib.net · https://www.npmjs.com/package/lrclib-api · https://jentic.com/apis/musixmatch.com/musixmatch.md
- Stem separation: https://huggingface.co/slaughters85j/htdemucs-coreml · https://pypi.org/project/demucs-onnx/
- Pitch shifting: https://breakfastquay.com/rubberband/license.html · https://superpowered.com/free-open-source-time-stretching-pitch-shifting
- Scoring research: https://www.isca-archive.org/interspeech_2025/hsieh25c_interspeech.pdf · https://smcnus.comp.nus.edu.sg/archive/pdf/2017-2018/2017_Perceptual_Evaluation_of_Singing_Quality.pdf · https://arxiv.org/pdf/2206.14357 · https://arxiv.org/pdf/1807.03046
- Fire TV Vega OS / React Native: https://developer.amazon.com/apps-and-games/blogs/2026/10/react-native-for-vega-os · https://developer.amazon.com/apps-and-games/blogs/2026/10/vega-2-0-sdk-launch · https://newly.app/guides/fire-tv-app-development
- Phone-as-mic landscape: https://agora.io/en/blog/how-to-create-an-online-karaoke-app-using-agora-sdk
