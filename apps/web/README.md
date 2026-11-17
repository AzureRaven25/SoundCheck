# SoundCheck website

Next.js 16 (App Router, Turbopack) + React 19 + Tailwind v4 + Supabase (`@supabase/ssr`).

## Run
```bash
supabase start                                    # local backend (repo root)
supabase functions serve --env-file supabase/functions/.env   # local Edge Functions
cp apps/web/.env.example apps/web/.env.local      # then fill in the URL + publishable key
npm run dev -w @soundcheck/web                    # http://localhost:3000
```
To browse the real 1M-song cloud catalog instead, point `.env.local` at `https://ppmzqjrfcbemzzbwicrd.supabase.co` with the cloud publishable key.

## What's here
- **Pages:**
  - `/` home (hero, recently played, classics shelves)
  - `/search` (tiered `catalog-search`: Supabase → Turso → MusicBrainz)
  - `/track/[id]` (artwork, play, favorite, synced lyrics)
  - `/album/[id]`, `/artist/[id]`
  - `/library` (favorites, playlists, history)
  - `/playlist/[id]` (play, rename, public/private, remove, delete)
  - `/settings` (profile, leaderboard visibility, Stage preferences)
  - `/login`, `/signup`, `/auth/callback`
- **Player** (`src/player`):
  - pure queue logic (`queue.ts`, unit-tested): shuffle as a separate play order, repeat off/all/one, play next, add to queue;
  - a zustand store;
  - `PlayerHost`: the single `<audio>` element, Media Session API (OS media keys, lock screen), listening history.
- **Audio sources** (`src/lib/audio.ts`): your own upload (signed URL), then licensed/shared content, then a 30-second store preview with Apple Music attribution.
- **Artwork** (`src/components/ui/Artwork.tsx`): stored URL, otherwise resolved lazily (max 4 at a time, transient failures retried), otherwise a generated gradient.
- **Auth:** `src/proxy.ts` (Next 16's renamed middleware) refreshes the session cookie and guards `/library` and `/settings`.

## Tests
```bash
npm test -w @soundcheck/web          # Vitest (queue logic)
npx playwright test -c apps/web      # E2E against the local stack: home, search, auth, favorites, playlists, settings, player
```
