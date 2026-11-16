# karaoke-catalog

> **SoundCheck note:** local Postgres is now only a *staging area*. The live catalog is in Supabase, filled by `sync-supabase` below. Persistent app data never lives on the Mac.

A searchable database of (nearly) every released song, built from the open **MusicBrainz** database and linked to the songs you've processed with [services/pipeline](../pipeline/README.md). The design is in §4.1 of [docs/PLAN.md](../../docs/PLAN.md).

## Setup (macOS)

```bash
brew install postgresql@17 && brew services start postgresql@17
cd services/catalog
uv sync
uv run karaoke-catalog init-db
```

The database URL comes from `$KARAOKE_DATABASE_URL` (default `postgresql:///karaoke`).

## Import MusicBrainz

1. Download the latest full export, `mbdump.tar.bz2` (~7 GB), from <https://data.metabrainz.org/pub/musicbrainz/data/fullexport/>. Check it against `SHA256SUMS` from the same folder.
2. Import it:

   ```bash
   uv run karaoke-catalog import-musicbrainz ../../data/musicbrainz/mbdump.tar.bz2
   ```

The import extracts only the 15 tables it needs into `data/musicbrainz/extracted/`. It loads them into temporary `mb.*` tables, builds `catalog.*`, rebuilds the search indexes, and drops the temporary tables. It runs in a single transaction, so a failed import leaves the previous catalog untouched. Re-running it on a newer dump refreshes the catalog; your library links and wishlist are kept.

MusicBrainz core data is CC0 (public domain).

### Which recordings become songs

- **Included:** recordings on *official* Albums, Singles and EPs, including compilations and soundtracks.
- **Excluded:**
  - Releases that are live, remix, DJ-mix, demo, spoken word, audiobook or interview.
  - Bootlegs and promos.
  - Music videos.
  - Recordings marked live, instrumental, karaoke or demo, in either the title or the MusicBrainz disambiguation comment.
- **Grouping:** recordings with the same artist credit and the same normalised title become **one song**. That's how remasters and compilation reissues collapse together.
- **Popularity:** `release_count`, the number of eligible releases featuring the song, is a rough stand-in. Hits appear on many compilations.

## Use it

```bash
uv run karaoke-catalog search "bohemian rhaps"       # prefix search, accent-insensitive, typo fallback
uv run karaoke-catalog search "queen" --available     # only songs in your library
uv run karaoke-catalog link-library ../pipeline/library
uv run karaoke-catalog wishlist add <song-id>
uv run karaoke-catalog wishlist list
uv run karaoke-catalog stats
```

`link-library` matches each processed bundle to a catalog song. It tries these methods in order:

1. MusicBrainz recording ID (written by MusicBrainz Picard).
2. ISRC.
3. Exact title + artist. Remaster suffixes are ignored, and the duration must be within 10 s.
4. Fuzzy title + artist.

Bundles that don't match anything stay in the library and are still singable.

## Tables (`catalog` schema)

| Table | Contents |
|---|---|
| `song` | One row per song: title, artist credit, length, first release date, cover-art release group, popularity, full-text `search` vector |
| `artist`, `song_artist` | Artists and their position in each song's credit |
| `song_recording` | Every MusicBrainz recording ID → song |
| `song_isrc` | ISRC → song |
| `library_item` | Processed bundles and the song each one matched (if any) |
| `wishlist` | Songs you want to add (keyed by recording ID, so it survives re-imports) |
| `import_run` | Import history |

Cover art: `https://coverartarchive.org/release-group/<release_group_mbid>/front-250`.

## Tests

Needs the local Postgres. Tests use a separate `karaoke_test` database and a tiny fake dump of fictional artists.

```bash
uv run pytest
```

## Sync to the SoundCheck cloud catalog

1. Load the dump into staging. Run `import-musicbrainz` once; its raw `mb.*` tables are what's needed. If its slow legacy transform is still running, cancel it.
2. Build the ranked song list. It takes about 6 minutes on an M5 for 26.5 M songs:
   ```bash
   psql -d karaoke -f src/karaoke_catalog/sql/ranked_subset.sql
   ```
   Popularity = 3 × release groups by *other* artists (compilations/soundtracks) + min(own groups, 5), excluding placeholder titles and special-purpose artists.
3. Upsert the top N into Supabase. This needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the repo's `.env.local`:
   ```bash
   uv run karaoke-catalog sync-supabase --top 25000
   uv run karaoke-catalog sync-supabase --start 25001 --top 75000   # extend later; idempotent
   ```
   Ids are MusicBrainz ids, so reruns and the on-demand `catalog-search` function never create duplicates.
