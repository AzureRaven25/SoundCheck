# karaoke-api

A FastAPI server that the TV app (and later the phone app) talks to. It serves:
- catalog search, from [services/catalog](../catalog/README.md);
- your singable library;
- song bundle files (audio stems, lyrics, melody), from [services/pipeline](../pipeline/README.md).

## Run

```bash
cd services/api
uv sync
uv run karaoke-api            # listens on 0.0.0.0:8000 so a TV on your Wi-Fi can reach it
```

Environment variables:
- `KARAOKE_DATABASE_URL`: default `postgresql:///karaoke`.
- `KARAOKE_LIBRARY_DIR`: default `services/pipeline/library`. Scanned and linked to the catalog at startup. Re-scan with `POST /api/library/scan`.

Interactive docs: <http://localhost:8000/docs>

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/api/health` | Server status and catalog size |
| GET | `/api/songs/search?q=&limit=&available=` | Catalog search (prefix, accent-insensitive, typo fallback) |
| GET | `/api/songs/popular?limit=` | Most-released songs ("Classics" row) |
| GET | `/api/library` | Singable songs (processed bundles) |
| GET | `/api/library/{bundle_id}` | One library song, including key, tempo and vocal range |
| GET | `/api/library/{bundle_id}/lyrics` | Synced lyrics JSON |
| GET | `/api/library/{bundle_id}/melody` | Reference melody JSON |
| GET | `/api/library/{bundle_id}/audio/{original\|instrumental\|vocals}` | Audio files (supports Range requests) |
| POST | `/api/library/scan` | Re-scan the library folder |
| GET / PUT / DELETE | `/api/wishlist[/{song_id}]` | Wishlist |

## Tests

```bash
uv run pytest
```

The tests use the `karaoke_test` database with the catalog's fake dump.
