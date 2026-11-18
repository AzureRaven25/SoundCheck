# SoundCheck research log

Living record of what was investigated, what was verified, and what we chose. Deep dives on vocal
separation, pitch detection, lyrics, transposition, microphones and infrastructure are in
[docs/RESEARCH.md](docs/RESEARCH.md). This file is the current source of truth for **music sources and
playback**.

Legend: ✅ verified by us (request made, docs/code read, or played) · ⚠️ stated by the provider but not
verified by us · ❌ not available / not permitted. Last re-verified **2026-11-17**. Internet Archive metadata lengths can be seconds off for VBR MP3s (165.1 s listed vs 156.87 s decoded), so the player shows the decoded duration and processing writes the measured one back.

## 1. Capabilities are separate

A provider having a song's *metadata* says nothing about *audio*. SoundCheck tracks each capability on its
own (`packages/contracts/src/providers.ts`):

| Capability | Meaning |
|---|---|
| search / metadata / artwork / lyrics | catalog data only |
| preview | a short clip (≈30 s). Always labelled as a preview; never looped, never presented as the song |
| full | the complete recording, with its real duration |
| karaoke | we may decode the audio and derive stems (vocal separation, analysis, key shift) |

## 2. The sources you supplied

| Source | What it actually is | Catalog | Metadata | Artwork | Lyrics | Preview | Full-length | Karaoke eligible | Status |
|---|---|---|---|---|---|---|---|---|---|
| limusic.app | ✅ "Ad-free YouTube Music player for desktop and Android" (site, fetched 2026-11-17). A third-party client for YouTube Music | via YT Music | via YT Music | via YT Music | ❌ | ❌ | ❌ for us: ad-blocking clients break YouTube's Terms | ❌ | ❌ Not integrated. Legitimate equivalent: YouTube's official IFrame player (§3) |
| music.youtube.com | Google's streaming service; no public music API ✅ | ❌ (no API) | ❌ | ❌ | ❌ | ❌ | Only inside YouTube's own players | ❌ YouTube's developer policies list separating or isolating audio from a video as a restricted practice ✅ (developer-policies guide) | ⚙️ Official IFrame player adapter (needs `YOUTUBE_API_KEY` for search) |
| monochrome.st | ✅ Open-source web client ("monochrome-music" on GitHub) that streams *and downloads* hi-res audio through third-party "Tidal HiFi API" instances with a Deezer fallback, unaffiliated with any service (site, fetched 2026-11-17) | — | — | — | — | — | Uses shared access to Tidal/Deezer outside their apps | ❌ | ❌ Not integrated: depends on circumventing streaming services' access controls |
| artistgrid.cx | Community tracker of unreleased/leaked songs ⚠️ (previous research; unchanged) | leaks | leaks | — | — | — | Unlicensed recordings | ❌ | ❌ Not integrated |
| betterlyrics.org | Browser extension adding synced lyrics to YouTube Music; aggregates other lyric sources ⚠️ | — | — | — | ✅ via upstreams | — | — | — | ❌ No public API. ✅ We use its upstream, LRCLIB, directly |
| lucida.to | Downloader that rips Qobuz/Tidal/Deezer/Amazon using shared accounts ⚠️ | — | — | — | — | — | Circumvents DRM/subscriptions | ❌ | ❌ Not integrated |
| antra.hoshi.cfd | ✅ "Paste a link. Get lossless audio." Free downloader for Spotify/Apple Music/Amazon/Tidal/Qobuz/Deezer links, with Patreon "supporter keys" (site, fetched 2026-11-17) | — | — | — | — | — | Unlicensed copies of streaming catalogs | ❌ | ❌ Not integrated |
| doubledouble.top | Same category as lucida (streaming-service ripper) ⚠️ | — | — | — | — | — | Circumvents DRM | ❌ | ❌ Not integrated |
| redacted.sh | Private music BitTorrent tracker ⚠️ | — | — | — | — | — | Unlicensed distribution | ❌ | ❌ Not integrated |
| orpheus.network | Private music BitTorrent tracker ⚠️ | — | — | — | — | — | Unlicensed distribution | ❌ | ❌ Not integrated |
| new-team.org | Couldn't verify: returns HTTP 403 to automated requests (2026-11-17); no public docs or API found | ? | ? | ? | ? | ? | ? | ? | ❌ No usable capability found |
| lidarr.audio | Open-source (GPL) collection manager. Metadata from MusicBrainz (via its SkyHook proxy); acquires files via torrent/Usenet indexers ⚠️ | ✅ via MusicBrainz | ✅ | — | — | — | Only what the user already owns | — | ✅ Same metadata source (MusicBrainz, used directly). Its *library* role is covered by the personal-server adapters (§4) |

## 3. Official streaming providers

| Provider | Full-length playback | Karaoke processing | Notes | Status |
|---|---|---|---|---|
| **Apple Music** (MusicKit JS v3 / MusicKit for iOS & tvOS) | ⚠️ Yes for Apple Music subscribers after user authorization. Needs a **developer token** (Apple Developer Program, an origin-bound JWT signed with a MusicKit key) | ❌ FairPlay-protected stream; no access to samples, so no separation or analysis | Use for the *listening* experience only, never as a karaoke source | ⚙️ Built on the web: `apple-music` Edge Function signs the ES256 developer token (unit-tested with a generated key); song pages match by ISRC, then search, and play with MusicKit JS v3. **Playback not yet verified**: needs `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` and a subscriber account |
| **Spotify** (Web Playback SDK / Web API) | Premium users only ⚠️ | ❌ Spotify's compliance guidance lists *syncing sound recordings with lyrics or video* as prohibited, its SDK reference says apps may not *alter Spotify Content*, and commercial use of the SDK needs prior written approval ✅ (developer.spotify.com/compliance-tips, Web Playback SDK reference) | A karaoke app showing synced lyrics over Spotify audio is exactly the prohibited sync use | ❌ No playback. ✅ Metadata/links only ("Open in Spotify", oEmbed artwork for pasted links) |
| **YouTube** (IFrame Player API + Data API v3) | ✅ Full videos inside the official embedded player (visible player, YouTube ads/branding intact, no background play) | ❌ Restricted: separating or isolating audio from a video ✅ | Search needs a free Data API key; a pasted YouTube link needs no key | ✅ Built on the web (listening only): **the site's main player plays songs in full through YouTube's IFrame player** (docked, visible ≥ 200 px, YouTube ads/branding intact), using a known video, a link the user chose on the song page (remembered on their device), or a search. Song pages also embed YouTube's player (privacy-enhanced youtube-nocookie.com) from a pasted YouTube/YouTube Music link (E2E). ⚙️ Automatic search (`youtube` Edge Function, results cached 7 days) needs `YOUTUBE_API_KEY` |
| Deezer | Full-length only for logged-in users inside Deezer's own widget ⚠️; API gives 30 s previews ✅ | ❌ | API terms restrict commercial use ⚠️ | ⏸ Not integrated (iTunes already covers previews) |
| Tidal / Qobuz | No public third-party playback SDK for the web ⚠️ | ❌ | Partner programs only | ❌ Not integrated |
| SoundCloud | Widget API plays tracks inside SoundCloud's own player ⚠️; new API apps are invite-only ⚠️ | ❌ | | ⏸ Candidate for listening via the widget |
| iTunes Search API | 30 s previews ✅ (existing) | ❌ | Labelled "Preview · 30 s" with an Apple Music link | ✅ Integrated (preview tier only) |

## 4. Full-length sources we can legitimately process

| Source | What we verified | Full-length | Karaoke | Status |
|---|---|---|---|---|
| **Your own uploads** | Existing pipeline: upload → HTDemucs stems → melody → word alignment ✅ (E2E tests) | ✅ | ✅ (you own the copy; stems stay private to you) | ✅ Integrated |
| **Internet Archive** (netlabels, Creative Commons / public-domain audio) | ✅ `advancedsearch.php` returns 61,276 CC-licensed netlabel albums with `licenseurl`; `/metadata/{id}` lists per-track MP3/OGG/FLAC files with real lengths (e.g. 509.22 s), no API key, CORS-enabled | ✅ real files, real durations | ✅ when the license allows derivatives (not `-nd`); always with attribution; NC licenses = non-commercial use only | ✅ Integrated (`open-music` function, "Open music" source). Web: search, albums, full-length player, karaoke prep. **Fire TV: full-length playback verified on the emulator** (46 s+ of a 156 s track, true duration); Apple TV: same code path, built, not yet run |
| **Personal music servers**: Navidrome / Airsonic / Gonic (Subsonic API), Jellyfin | ✅ Tested against **Navidrome 0.64.2** and **Jellyfin 12.4.0** in local Docker: Subsonic token auth (`t = md5(password + salt)`), `search3`, `stream`; Jellyfin `/Users/AuthenticateByName`, `/Users/{id}/Items`, `/Audio/{id}/stream?static=true` (Jellyfin 12.4 rejects `api_key` on `/universal` with 401). Both send `Access-Control-Allow-Origin: *` | ✅ the user's own files (75 s test song played past 30 s at its true length) | ✅ the user's own copies: "Use my music server’s copy" uploads the file to the user's private Storage and runs the normal pipeline (E2E) | ✅ Integrated on the web; credentials (a salted token / access token, never the password) stay in this browser. An https page can't reach an http LAN server (mixed content): use the server's https address |
| Jamendo | CC-licensed catalog; API needs a free `client_id` ⚠️; commercial use needs Jamendo Licensing | ✅ | ✅ personal use when not ND | ⏸ Candidate (needs `JAMENDO_CLIENT_ID`) |
| Free Music Archive | Public API was retired ⚠️ | — | — | ❌ |

## 5. Playback acceptance (how "full-length" is verified)

Automated (`apps/web/e2e/playback.spec.ts`): play a full-length source, assert playback passes 30 s and keeps
going, that the reported duration matches the provider's (not 30 s), that pause/resume/seek work, and
that it reaches the real end. Previews must report themselves as previews. Results are recorded in
`docs/COMPATIBILITY.md`.

## 6. Decisions

1. **No piracy, ripping or shared-account infrastructure**, whatever the source list says. Every source in
   §2 except LRCLIB (via BetterLyrics) and MusicBrainz (via Lidarr) was rejected for that reason.
2. **Listening and karaoke are separate experiences.** Official players (Apple Music, YouTube) power
   listening; karaoke uses audio we may process: your uploads, your personal server, open-licensed
   recordings.
3. **One provider interface, honest capabilities.** The app picks the best playable source for each track
   and says exactly what it is ("Full track · Internet Archive · CC BY-NC-SA", "Preview · 30 s").

## 7. Hearing yourself: voice through the TV (2026-11-17)

| Option | Latency | Verdict |
|---|---|---|
| **WebRTC audio (Opus), phone → host peer-to-peer**, signalling over the session's private Realtime channel | ~100–200 ms on home Wi-Fi ⚠️ (browser jitter buffer + Wi-Fi) | ✅ **Built (web host + web phones)**. Opt-in "Hear singers through the speakers" with a volume control; uses the phone's echo-cancelled mic. E2E: two phones connected, voices arriving at ≈ −24 dBFS |
| Audio over WebSockets / Realtime broadcast | 200 ms+, no jitter handling, 1 KB message limits | ❌ |
| Cloud relay (SFU/TURN) for all audio | +RTT to the cloud; costs | ⏸ Only as a fallback: today STUN only (`stun.l.google.com`), so phones and TV must reach each other directly (same Wi-Fi is the normal case) |
| Native TVs (tvOS / Fire TV) receiving WebRTC | needs Google's libwebrtc in the apps | ⏸ Next: the Swift/Kotlin protocol layers already ignore `voice`/`rtc` messages safely |

Scoring never depends on this audio: phones still compute pitch locally and send compact pitch frames, so
scores stay accurate even on poor Wi-Fi. The voice stream is only for hearing yourself in the room.

## 8. Acquisition ecosystem: FMHY "Group C" audit and the sources we built (2026-11-17)

FMHY's audio page (fmhy.net/audio, fetched 2026-11-17) lists "Audio Ripping Sites" and "Audio Ripping Tools".
Each tool was checked individually against its own code or docs. Categories used below:
**M** metadata/catalog · **P** official playback · **A** authorized file acquisition (purchase, artist-offered
download, open license) · **U** user-provided media · **X** protected-stream extraction (decrypting DRM, scraped app
secrets, or shared/pooled subscription accounts).

### 8.1 Per-tool findings

| Tool (FMHY note) | What it actually does (evidence) | Category | Reusable part | Decision |
|---|---|---|---|---|
| **lucida** ("Amazon Music / Soundcloud / FLAC") | Web service that returns files from streaming services through accounts it operates | X | none (closed service) | ❌ |
| **Monochrome** ("Multi-Site / FLAC…") | Open-source client streaming/downloading via third-party "Tidal HiFi API" instances; downstream projects describe "download as FLAC" via Monochrome/Tidal (GitHub search, 2026-11-17) | X | none: the metadata comes from Tidal's private API | ❌ |
| **Antra Web / Antra** ("Requires Sign-Up"; Qobuz/Tidal/Amazon/Soulseek) | Paste-a-link downloader with Patreon "supporter keys" (site, 2026-11-17) | X | none | ❌ |
| **DoubleDouble** (Amazon / SoundCloud / FLAC) | Same model as lucida | X | none | ❌ |
| **Jumo-DL, ARCOD** (Qobuz) | Qobuz downloaders via operated accounts | X | none | ❌ |
| **Rhythmax TIDAL / JioSaavn, cyan-dl, squid.wtf, Lossless Music Download (Kuwo)** | Service-specific rippers | X | none | ❌ |
| **Rip Anything From Anywhere, vdwn.cloud, CYBROX, AMP3, AudioFetcher, Spotisaver, Riplet** | Convert links to 320 kbps MP3 by pulling YouTube audio (Spotisaver: "accepts Spotify links but uses YouTube") | X (YouTube ToS forbids downloading) | Spotify-link → song matching (we already resolve songs by title/artist/ISRC) | ❌ download; ✅ matching exists |
| **YTiz, cobalt (AGPL-3.0), you-get** | Save SoundCloud/Bandcamp/YouTube streams regardless of the uploader's download setting | X | none | ❌. Legit SoundCloud route: tracks the uploader made downloadable, imported as files (§8.3) |
| **Mornye, Firehawk52** (Deezer/Qobuz/Tidal, "Requires Sign-Up") | Share/issue streaming-service credentials for the rippers below | X | none | ❌ |
| **streamrip** (GPL-3.0, active) | Qobuz/Tidal/Deezer/SoundCloud downloader. `streamrip/client/qobuz.py` has a `QobuzSpoofer` that scrapes `bundle.js` from Qobuz's web player for `appId`/`appSecret` | X | Its tagging/folder layout ideas; nothing that needs the services | ❌ |
| **qobuz-dl / QobuzDownloaderX(-MOD)** (GPL-3.0) | Same Qobuz bundle scraping (`qobuz_dl/bundle.py`: `appId:"…",appSecret:"…"` regex) | X | none | ❌ |
| **OrpheusDL** (modular, last push 2023-12) | Module framework; modules for Qobuz/Tidal/Deezer etc. use service credentials ("Use Firehawk52") | X | The *module* idea (one adapter per source) is the same design as our `Adapter` interface | ❌ modules; ✅ design |
| **Deemix / DeemixFix / Deemix Revival / SaturnMusic** | Deezer downloader; `deemix/decryption.py` derives a per-track Blowfish key (`generateBlowfishKey`) and decrypts the protected stream | X (decryption) | Deezer's **public** API (search, ISRCs, artwork) is separate and permitted | ❌ downloads; ✅ Deezer metadata adapter |
| **OnTheSpot** (Apple Music/Bandcamp/Deezer/Qobuz/Spotify/Tidal) | Multi-service downloader using account sessions (repo moved, 2026-11-17) | X | none | ❌ |
| **Votify** (MIT, archived) | Spotify downloader; README requires exported Spotify cookies and a `.wvd` Widevine device file for AAC | X (Widevine) | none | ❌ |
| **Murglar** (Deezer/SoundCloud/VK) | Player/downloader for those services | X | none | ❌ |
| **MusicDL** (Chinese platforms) | Scraper/downloader | X | none | ❌ |
| **NullBeat** ("TorBox-based") | Fetches via a debrid/torrent service | X | none | ❌ |
| **Nicotine+ / Soulseek** (GPL-3.0) | P2P client; files are whatever peers share | U for your *own* library, otherwise unlicensed | none needed: your own files come in through the importer | ❌ as a source |
| **BandCamp-DL** (Unlicense, "Free Only") | Reads `trackinfo[].file["mp3-128"]` from the album page (`bandcamp_dl/bandcamp.py` l.310): the 128 kbps *stream* file, present for any streamable track, not only free ones | X when used on paid tracks | Bandcamp's own downloads (purchases and free/name-your-price, via the official download page) are authorized | ✅ via **Import** (Bandcamp ZIP names parsed) |
| **Exact Audio Copy, whipper** (GPL-3.0) | CD rippers that verify against AccurateRip and write logs | U (discs you own) | Rip logs: per-track AccurateRip result | ✅ **Import** reads EAC/XLD/whipper logs and records "AccurateRip verified (confidence N)" |
| **AccurateRip** | Checksum database for verifying rips | U | verification | ✅ (via the logs above) |

### 8.2 Sources we tested for complete recordings

"Full" means a file we downloaded and **decoded** (`scripts/verify_full_length.py`, ffprobe) is > 60 s and within 5 % of
the listed length; previews and metadata never count.

| Source | Access | Catalog | Full-length (decoded) | Karaoke | Status |
|---|---|---|---|---|---|
| **Openverse → Jamendo** | Openverse API, no key | 644,709 Jamendo tracks (Openverse stats) | ✅ 6/6 (e.g. "Let's Fall In Love", FOXAPET: listed 255.0 s, decoded 254.8 s); CORS-enabled MP3 | ✅ when CC without ND (worker allow-list: `storage.jamendo.com`) | ✅ Integrated |
| **Openverse → Wikimedia Commons** | same | 3.99 M audio files, mostly not songs; filtered to ≥ 45 s | ✅ "Beethoven Symphony 7 Allegretto" listed 659.6 s, decoded 659.6 s (Commons MP3 transcode) | ✅ when CC/PD without ND | ✅ Integrated |
| **Audius** | public API (`app_name`), no key | independent artists' uploads | ✅ 5/5 (e.g. "Must B Love": 320.0 s listed, 320.2 s decoded); CORS-enabled | Only for CC-licensed tracks (most are "All rights reserved" → listen only); gated tracks skipped | ✅ Integrated |
| **Internet Archive** | advancedsearch + metadata, no key | widened from netlabels (62k items) to + community music uploads (186k) with an explicit license | ✅ (verified earlier) | ✅ license permitting | ✅ Integrated (wider search) |
| **Jamendo API (direct)** | free `client_id` | ~600k | expected same files as Openverse | ✅ when `audiodownload_allowed` and not ND | ⚙️ Built; needs `JAMENDO_CLIENT_ID` (free sign-up at devportal.jamendo.com, which only you can do) |
| **ccMixter** | API, no key | CC remixes, many a cappellas | ❌ `ccmixter.org/content/…` answers **403** to non-site requests (2026-11-17) | — | ✅ Discovery + links only (we don't work around the 403) |
| **Deezer** | public API, no key | large commercial catalog | ❌ metadata only (audio is DRM) | ❌ | ✅ Metadata adapter (ISRC, artwork) |
| **Bandcamp** | no public fan API | — | ✅ the files you download from Bandcamp | ✅ your copy | ✅ via Import (ZIP + name parsing) |
| **SoundCloud** | API access requires an approved app ⚠️ | — | uploader-enabled downloads, as files | ✅ your copy | ✅ via Import; API adapter ⏸ until credentials exist |
| **Your files / CD rips** | — | your library | ✅ (E2E) | ✅ (E2E: processed to karaoke) | ✅ Import page |

### 8.3 Architecture

- `supabase/functions/_shared/acquisition.ts`: one `Adapter` per source (`search`, `get`, `missing()` credentials).
  Each result says `availability` (`full` | `preview` | `metadata`), `karaoke_ok`, license, format and quality.
  A new source is one object added to `ADAPTERS`.
- `acquire` Edge Function: `search` (all sources in parallel, per-source status incl. "not configured"), `import` /
  `import_many` (idempotent on provider + id; de-duplicated against the catalog by normalized title + artist and
  duration within 4 s), `prepare` (queues the normal karaoke pipeline for an eligible open recording).
  Every outcome is written to `acquisition_log`.
- `track_availability(ids)` RPC: one scale per song: catalog → preview → full → karaoke-eligible → karaoke-ready.
- Import (`/import`): folders (drag-and-drop or picker), ZIPs, M3U/M3U8/PLS → playlists, EAC/XLD/whipper logs →
  AccurateRip provenance, tags (music-metadata) with filename fallbacks, SHA-256 duplicate detection per user,
  3 files in parallel, pause/resume and "retry failed" (all steps idempotent), optional karaoke for every file.
- The worker downloads open originals only from an allow-list (archive.org, api.audius.co → Audius content
  nodes on public hosts, storage.jamendo.com, upload.wikimedia.org).

### 8.4 Catalog growth (cloud, 2026-11-17)

Seeded with `scripts/seed_open_catalog.py` (45 genre/mood queries) and verified by decoding random samples
(12/12 Openverse + Audius, 5/5 Internet Archive complete at their listed length):

| Source | Full-length songs in the catalog before → after |
|---|---|
| Openverse (Jamendo + Wikimedia Commons) | 0 → 793 → 1,065 (second pass; Openverse then rate-limited us) |
| Audius | 0 → 1,008 → 2,283 |
| Internet Archive (netlabels, Jamendo + FMA mirrors, community music) | 0 → 4,305 → 7,038 |
| **Total** | **10,386** |

Any search also finds more on demand ("Full songs from open sources"), and played results join the catalog.
Caveat: Internet Archive and Audius licenses are declared by the uploader; both sites handle takedowns, and
SoundCheck shows the declared license and source next to every song. Covers of other artists' songs uploaded
under a CC license only license the recording, not the underlying composition.

**More Internet Archive collections (2026-11-17):** the archive mirrors Jamendo's catalog (`jamendo-albums`:
294,067 albums, 235,022 with an explicit license) and the Free Music Archive (`freemusicarchive`: 8,794 licensed).
Both are now part of open-music search, so Jamendo music is reachable without a Jamendo key and without
Openverse's anonymous rate limit (which started refusing our requests during bulk seeding).
