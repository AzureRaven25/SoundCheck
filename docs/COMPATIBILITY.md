# Platform Compatibility Matrix

Status key: ✅ done & tested · 🧪 implemented, partially verified · 🚧 in progress · ⬜ not started · — not applicable

*Last updated: M3 complete (2026-11-17).*

| Feature | Website | Apple TV | Fire TV | iOS | Android |
|---|---|---|---|---|---|
| Shared Supabase backend: schema, RLS, RPCs, storage, realtime auth (60 DB tests, deployed) | ✅ backend · ⬜ client | ✅ backend · ⬜ client | ✅ backend · ⬜ client | ✅ backend · ⬜ client | ✅ backend · ⬜ client |
| Realtime session protocol (contracts + golden fixtures) | ✅ TS | ⬜ Swift port | ⬜ Kotlin port | ⬜ Swift port | ⬜ Kotlin port |
| Accounts / sign-in | ✅ email+password (E2E) | ⬜ | ⬜ | ⬜ | ⬜ |
| Profiles & preferences | ✅ (E2E) | ⬜ | ⬜ | ⬜ | ⬜ |
| Catalog search (backend: 1M songs, tiered) | ✅ (E2E) | ⬜ | ⬜ | ⬜ | ⬜ |
| Artist / album / track pages | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| Album artwork (CAA → iTunes, lazy + cached) | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| Music playback (own uploads; 30 s previews until then) | ✅ previews verified | ⬜ | ⬜ | ⬜ | ⬜ |
| Queue / shuffle / repeat | ✅ (unit + E2E) | ⬜ | ⬜ | ⬜ | ⬜ |
| Playlists & favorites | ✅ (E2E) | ⬜ | ⬜ | ⬜ | ⬜ |
| Listening history | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| Upload own audio | ⬜ | — | — | ⬜ | ⬜ |
| Vocal separation (via cloud pipeline) | ⬜ | ⬜ | ⬜ | — | — |
| Karaoke playback (stems + guide vocal) | ⬜ | ⬜ | ⬜ | — | — |
| Line-synced lyrics | ✅ (sync with full-length audio) | ⬜ | ⬜ | ⬜ | ⬜ |
| Word-level highlighting | ⬜ | ⬜ | ⬜ | — | — |
| Key transposition | ⬜ | ⬜ | ⬜ | — | — |
| Host session + QR / pairing code | ⬜ | ⬜ | ⬜ | — | — |
| Join session (scan / code) | ⬜ (browser /join) | — | — | ⬜ | ⬜ |
| Phone microphone + calibration | ⬜ (browser) | — | — | ⬜ | ⬜ |
| Multiple singers | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| SoundCheck Score + results | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Leaderboards / achievements | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Party mode / singer queue | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

Legacy prototypes (`apps/tv` React Native TV app, `services/api`) are not counted. They are being replaced.
