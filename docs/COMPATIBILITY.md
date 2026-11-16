# Platform Compatibility Matrix

Status key: ✅ done & tested · 🧪 implemented, partially verified · 🚧 in progress · ⬜ not started · — not applicable

*Last updated: M1 complete (2026-11-16).*

| Feature | Website | Apple TV | Fire TV | iOS | Android |
|---|---|---|---|---|---|
| Shared Supabase backend: schema, RLS, RPCs, storage, realtime auth (60 DB tests, deployed) | ✅ backend · ⬜ client | ✅ backend · ⬜ client | ✅ backend · ⬜ client | ✅ backend · ⬜ client | ✅ backend · ⬜ client |
| Realtime session protocol (contracts + golden fixtures) | ✅ TS | ⬜ Swift port | ⬜ Kotlin port | ⬜ Swift port | ⬜ Kotlin port |
| Accounts / sign-in | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Profiles & preferences | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Catalog search | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Artist / album / track pages | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Album artwork | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Music playback | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Queue / shuffle / repeat | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Playlists & favorites | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Listening history | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| Upload own audio | ⬜ | — | — | ⬜ | ⬜ |
| Vocal separation (via cloud pipeline) | ⬜ | ⬜ | ⬜ | — | — |
| Karaoke playback (stems + guide vocal) | ⬜ | ⬜ | ⬜ | — | — |
| Line-synced lyrics | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
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
