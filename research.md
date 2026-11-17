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
| **Apple Music** (MusicKit JS v3 / MusicKit for iOS & tvOS) | ⚠️ Yes for Apple Music subscribers after user authorization. Needs a **developer token** (Apple Developer Program, an origin-bound JWT signed with a MusicKit key) | ❌ FairPlay-protected stream; no access to samples, so no separation or analysis | Use for the *listening* experience only, never as a karaoke source | ⚙️ Adapter built; needs `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY` (server-side) |
| **Spotify** (Web Playback SDK / Web API) | Premium users only ⚠️ | ❌ Spotify's compliance guidance lists *syncing sound recordings with lyrics or video* as prohibited, its SDK reference says apps may not *alter Spotify Content*, and commercial use of the SDK needs prior written approval ✅ (developer.spotify.com/compliance-tips, Web Playback SDK reference) | A karaoke app showing synced lyrics over Spotify audio is exactly the prohibited sync use | ❌ No playback. ✅ Metadata/links only ("Open in Spotify", oEmbed artwork for pasted links) |
| **YouTube** (IFrame Player API + Data API v3) | ✅ Full videos inside the official embedded player (visible player, YouTube ads/branding intact, no background play) | ❌ Restricted: separating or isolating audio from a video ✅ | Search needs a free Data API key; a pasted YouTube link needs no key | ⚙️ Adapter built (listening only); search needs `YOUTUBE_API_KEY` |
| Deezer | Full-length only for logged-in users inside Deezer's own widget ⚠️; API gives 30 s previews ✅ | ❌ | API terms restrict commercial use ⚠️ | ⏸ Not integrated (iTunes already covers previews) |
| Tidal / Qobuz | No public third-party playback SDK for the web ⚠️ | ❌ | Partner programs only | ❌ Not integrated |
| SoundCloud | Widget API plays tracks inside SoundCloud's own player ⚠️; new API apps are invite-only ⚠️ | ❌ | | ⏸ Candidate for listening via the widget |
| iTunes Search API | 30 s previews ✅ (existing) | ❌ | Labelled "Preview · 30 s" with an Apple Music link | ✅ Integrated (preview tier only) |

## 4. Full-length sources we can legitimately process

| Source | What we verified | Full-length | Karaoke | Status |
|---|---|---|---|---|
| **Your own uploads** | Existing pipeline: upload → HTDemucs stems → melody → word alignment ✅ (E2E tests) | ✅ | ✅ (you own the copy; stems stay private to you) | ✅ Integrated |
| **Internet Archive** (netlabels, Creative Commons / public-domain audio) | ✅ `advancedsearch.php` returns 61,276 CC-licensed netlabel albums with `licenseurl`; `/metadata/{id}` lists per-track MP3/OGG/FLAC files with real lengths (e.g. 509.22 s), no API key, CORS-enabled | ✅ real files, real durations | ✅ when the license allows derivatives (not `-nd`); always with attribution; NC licenses = non-commercial use only | ✅ Integrated (`open-music` function, "Open music" source) |
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
