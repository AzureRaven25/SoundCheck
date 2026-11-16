# SoundCheck

A premium music streaming and karaoke platform. It has five apps sharing one Supabase backend:
- the **website**;
- **Apple TV** and **Fire TV** apps (the big-screen karaoke experience, *SoundCheck Stage*);
- **iOS** and **Android** companion apps (*SoundCheck Mobile*), which also act as wireless microphones.

Singers are scored by *SoundCheck Score*; group play is *SoundCheck Party*.

| | |
|---|---|
| Architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Research & provider decisions | [docs/RESEARCH.md](docs/RESEARCH.md) |
| Scoring methodology | [docs/SCORING.md](docs/SCORING.md) |
| Roadmap | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Feature × platform status | [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) |
| Repository assessment | [docs/ASSESSMENT.md](docs/ASSESSMENT.md) |

## Layout
```
apps/web          Next.js website (M3)
apps/apple        tvOS + iOS apps, SoundCheckKit (M6)
apps/android      Fire TV + Android apps, :core (M7)
packages/contracts  DB types + realtime protocol + golden fixtures
supabase/         migrations, tests, edge functions; the backend's source of truth
services/pipeline GPU worker: separation, melody, lyrics alignment
services/catalog  MusicBrainz import → Supabase catalog sync
```
Legacy prototypes being replaced: `apps/tv` (React Native TV app) and `services/api` (FastAPI).

## Backend development
```bash
brew install supabase/tap/supabase colima docker
colima start --cpu 6 --memory 10
supabase start            # local stack (analytics disabled for colima)
supabase test db          # pgTAP suite
supabase db push --linked # apply new migrations to the SoundCheck project
npm install && npm test   # TypeScript packages
```
Secrets: copy `.env.example` to `.env.local`. See the comments in that file.
